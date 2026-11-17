# Lambda image for the agent: Node 24, git, the GitHub CLI and the AWS CLI. arm64 only.
FROM public.ecr.aws/lambda/nodejs:24

ARG GH_VERSION=2.104.0
RUN dnf install -y git tar gzip unzip && dnf clean all \
 && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_arm64.tar.gz" | tar -xz -C /tmp \
 && mv /tmp/gh_${GH_VERSION}_linux_arm64/bin/gh /usr/local/bin/gh && rm -rf /tmp/gh_* \
 && curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip -o /tmp/awscli.zip \
 && unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscli.zip

WORKDIR ${LAMBDA_TASK_ROOT}
COPY package.json package-lock.json tsconfig.json ./
# Installs the Agent SDK's bundled Claude Code binary for linux-arm64.
RUN npm ci
COPY src ./src
COPY prompts ./prompts
RUN npx tsc && npm prune --omit=dev

CMD ["dist/src/handler.handler"]
