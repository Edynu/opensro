package workload

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

type NomadWorkloadIdentityVerifier struct {
	oidc *oidc.IDTokenVerifier
}

func NewNomadWorkloadIdentityVerifier(
	issuer string,
	jwksURL string,
	client *http.Client,
) (*NomadWorkloadIdentityVerifier, error) {
	issuer = strings.TrimSuffix(strings.TrimSpace(issuer), "/")
	jwksURL = strings.TrimSpace(jwksURL)
	if issuer == "" || jwksURL == "" {
		return nil, fmt.Errorf(
			"nomad workload identity issuer and JWKS URL are required",
		)
	}
	for label, raw := range map[string]string{
		"issuer":   issuer,
		"JWKS URL": jwksURL,
	} {
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Hostname() == "" {
			return nil, fmt.Errorf("nomad workload identity %s is invalid", label)
		}
		host := parsed.Hostname()
		loopback := strings.EqualFold(host, "localhost")
		if !loopback {
			if ip := net.ParseIP(host); ip != nil {
				loopback = ip.IsLoopback()
			}
		}
		if parsed.Scheme != "https" &&
			(parsed.Scheme != "http" || !loopback) {
			return nil, fmt.Errorf(
				"nomad workload identity %s must use HTTPS outside loopback",
				label,
			)
		}
	}
	ctx := context.Background()
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	ctx = oidc.ClientContext(ctx, client)
	keys := oidc.NewRemoteKeySet(ctx, jwksURL)
	return &NomadWorkloadIdentityVerifier{
		oidc: oidc.NewVerifier(
			issuer,
			keys,
			&oidc.Config{
				ClientID:             NomadAgentAudience,
				SupportedSigningAlgs: []string{"RS256", "EdDSA"},
			},
		),
	}, nil
}

func (verifier *NomadWorkloadIdentityVerifier) Verify(
	ctx context.Context,
	raw string,
) (IdentityClaims, error) {
	if verifier == nil || verifier.oidc == nil {
		return IdentityClaims{}, fmt.Errorf(
			"nomad workload identity verifier is unavailable",
		)
	}
	token, err := verifier.oidc.Verify(ctx, raw)
	if err != nil {
		return IdentityClaims{}, err
	}
	var claims IdentityClaims
	if err := token.Claims(&claims); err != nil {
		return IdentityClaims{}, fmt.Errorf(
			"decode Nomad workload identity claims: %w",
			err,
		)
	}
	if claims.Namespace == "" ||
		claims.JobID == "" ||
		claims.AllocationID == "" ||
		claims.Task == "" {
		return IdentityClaims{}, fmt.Errorf(
			"nomad workload identity omits required workload claims",
		)
	}
	return claims, nil
}
