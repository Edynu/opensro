package main

import (
	"fmt"
	"strings"

	"opensro.online/server/internal/transport"
)

const managedDevelopmentTLSIdentity = "managed-development"

// resolveTransportCertificate owns the deployment-time WebTransport TLS
// boundary. A production pair is loaded before Nomad mutation, checked
// against every public shard host, and reduced to a non-secret fingerprint
// that makes an in-place certificate renewal create a new job version.
func resolveTransportCertificate(
	certFile string,
	keyFile string,
	hostNetwork string,
	validate bool,
	shards []shardDeployment,
) (string, string, string, error) {
	certFile = strings.TrimSpace(certFile)
	keyFile = strings.TrimSpace(keyFile)
	if (certFile == "") != (keyFile == "") {
		return "", "", "", fmt.Errorf(
			"-transport-cert-file and -transport-key-file must be configured together",
		)
	}
	if certFile == "" {
		if validate && hostNetwork != "loopback" {
			return "", "", "", fmt.Errorf(
				"-transport-cert-file and -transport-key-file are required for host network %q",
				hostNetwork,
			)
		}
		return "", "", managedDevelopmentTLSIdentity, nil
	}

	certFile = cleanAbsolute(certFile)
	keyFile = cleanAbsolute(keyFile)
	if !validate {
		return slashPath(certFile), slashPath(keyFile), "", nil
	}
	if err := requireRegularFile(certFile); err != nil {
		return "", "", "", err
	}
	if err := requireRegularFile(keyFile); err != nil {
		return "", "", "", err
	}
	certificate, err := transport.LoadCertificate(certFile, keyFile, "")
	if err != nil {
		return "", "", "", fmt.Errorf(
			"WebTransport TLS certificate: %w",
			err,
		)
	}
	if hostNetwork != "loopback" {
		for _, game := range shards {
			endpoint, err := absoluteHTTPURL(game.Definition.TransportURL)
			if err != nil {
				return "", "", "", fmt.Errorf(
					"shard %q transport URL: %w",
					game.Definition.ID,
					err,
				)
			}
			if endpoint.Scheme != "https" {
				return "", "", "", fmt.Errorf(
					"shard %q transport URL must use HTTPS outside loopback",
					game.Definition.ID,
				)
			}
			if err := certificate.Leaf.VerifyHostname(endpoint.Hostname()); err != nil {
				return "", "", "", fmt.Errorf(
					"WebTransport certificate does not cover shard %q host %q: %w",
					game.Definition.ID,
					endpoint.Hostname(),
					err,
				)
			}
		}
	}
	return slashPath(certFile),
		slashPath(keyFile),
		certificate.SHA256Hex(),
		nil
}
