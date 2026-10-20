FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

COPY --from=docker.io/jdxcode/mise:2026.10.15 /usr/local/bin/mise /usr/local/bin/

# make sure mise is activated in both zsh and bash. Might be overridden by a user's dotfiles.
RUN echo 'eval "$(mise activate bash)"' >> /home/vscode/.bashrc && \
    echo 'eval "$(mise activate zsh)"' >> /home/vscode/.zshrc
 
USER vscode
RUN mkdir -p /home/vscode/.gnupg && chmod 700 /home/vscode/.gnupg
