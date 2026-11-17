import * as path from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Size,
  Stack,
  type StackProps,
  aws_ecr_assets as ecrAssets,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
  aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as tasks,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

export interface AgentStackProps extends StackProps {
  /** "owner/repo" entries the agent may work on. */
  allowedRepos: string[];
  /** Secrets Manager secret you create, holding ANTHROPIC_API_KEY, GITHUB_TOKEN and the JIRA_* values. */
  secretName: string;
  model?: string;
  /** Lambda invocations per task, each up to 15 minutes. */
  maxAttempts: number;
  maxBudgetUsdPerAttempt: number;
  /** Stops each attempt earlier than the Lambda limit, to test the resume path. */
  maxRunMs?: number;
}

export class AgentStack extends Stack {
  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    const secret = secretsmanager.Secret.fromSecretNameV2(this, "Config", props.secretName);

    const sessions = new s3.Bucket(this, "Sessions", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(30) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const fn = new lambda.DockerImageFunction(this, "Agent", {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, "..", "agent"), {
        platform: ecrAssets.Platform.LINUX_ARM64,
      }),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 4096,
      ephemeralStorageSize: Size.gibibytes(10),
      timeout: Duration.minutes(15),
      environment: {
        SECRET_ID: props.secretName,
        SESSION_BUCKET: sessions.bucketName,
        ALLOWED_REPOS: props.allowedRepos.join(","),
        MAX_BUDGET_USD: String(props.maxBudgetUsdPerAttempt),
        ...(props.model ? { AGENT_MODEL: props.model } : {}),
        ...(props.maxRunMs ? { MAX_RUN_MS: String(props.maxRunMs) } : {}),
      },
      logGroup: new logs.LogGroup(this, "AgentLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    secret.grantRead(fn);
    sessions.grantReadWrite(fn);

    // What the agent's `aws` CLI can see: metrics, alarms, logs (Logs Insights), traces and stack events. Read only.
    fn.role!.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchReadOnlyAccess"));
    fn.role!.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AWSXrayReadOnlyAccess"));
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents", "cloudformation:ListStacks"],
        resources: ["*"],
      }),
    );

    // Init → RunAgent → (CONTINUE and attempts left) → RunAgent ... → Done | Failed
    const init = new sfn.Pass(this, "Init", {
      parameters: { "event.$": "$", attempt: 0, "executionName.$": "$$.Execution.Name" },
    });
    const run = new tasks.LambdaInvoke(this, "RunAgent", {
      lambdaFunction: fn,
      payloadResponseOnly: true,
      retryOnServiceExceptions: true,
    });
    const next = new sfn.Choice(this, "Next")
      .when(sfn.Condition.stringEquals("$.status", "DONE"), new sfn.Succeed(this, "Done"))
      .when(
        sfn.Condition.and(
          sfn.Condition.stringEquals("$.status", "CONTINUE"),
          sfn.Condition.numberLessThan("$.attempt", props.maxAttempts),
        ),
        run,
      )
      .otherwise(new sfn.Fail(this, "Failed", { errorPath: "$.status", causePath: "$.summary" }));

    const machine = new sfn.StateMachine(this, "Workflow", {
      definitionBody: sfn.DefinitionBody.fromChainable(init.next(run).next(next)),
      timeout: Duration.minutes(16 * props.maxAttempts + 10),
    });

    // Producers put events with source "agentic-sdlc" and detail-type "AgentRequest"; the detail is the event contract.
    const bus = new events.EventBus(this, "Bus", { eventBusName: "agentic-sdlc" });
    new events.Rule(this, "AgentRequests", {
      eventBus: bus,
      eventPattern: { source: ["agentic-sdlc"], detailType: ["AgentRequest"] },
      targets: [new targets.SfnStateMachine(machine, { input: events.RuleTargetInput.fromEventPath("$.detail") })],
    });

    new CfnOutput(this, "StateMachineArn", { value: machine.stateMachineArn });
    new CfnOutput(this, "EventBusName", { value: bus.eventBusName });
    new CfnOutput(this, "FunctionName", { value: fn.functionName });
    new CfnOutput(this, "SessionBucketName", { value: sessions.bucketName });
  }
}
