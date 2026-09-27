# Development only: one loopback Nomad agent acts as both server and client.
# Production uses the separate server/client examples in this directory.

bind_addr = "127.0.0.1"
log_level = "INFO"

plugin "raw_exec" {
  config {
    enabled = true
    denied_envvars = [
      "NOMAD_TOKEN",
      "NOMAD_LICENSE",
      "NOMAD_LICENSE_PATH",
      "CONSUL_*",
      "VAULT_*",
      "AWS_*",
      "AZURE_*",
      "ARM_*",
      "GOOGLE_*",
      "GITHUB_*",
      "GITLAB_*",
    ]
  }
}

client {
  enabled          = true
  max_kill_timeout = "90s"

  meta {
    sro_agent  = "true"
    sro_shards = "global-official,test"
  }

  host_network "loopback" {
    cidr = "127.0.0.1/32"
  }
}

server {
  enabled          = true
  bootstrap_expect = 1
  oidc_issuer      = "http://127.0.0.1:4646"
}
