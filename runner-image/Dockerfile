FROM hashicorp/terraform:1.9.0
RUN apk add --no-cache git
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
WORKDIR /workspace
ENTRYPOINT ["/entrypoint.sh"]
