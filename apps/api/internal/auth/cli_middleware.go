package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
)

type cliCtxKey int

const cliAuthKey cliCtxKey = 1

// CLIAuth is set when the request authenticated with a namespace-scoped CLI token.
type CLIAuth struct {
	TokenID     uuid.UUID
	NamespaceID uuid.UUID
	CreatedBy   *uuid.UUID
}

func CLIFromContext(ctx context.Context) *CLIAuth {
	a, _ := ctx.Value(cliAuthKey).(*CLIAuth)
	return a
}

// CLITokenResolver resolves hashed companion CLI tokens (implemented by secrets.Service).
type CLITokenResolver interface {
	ResolveCLIToken(ctx context.Context, raw string) (tokenID, nsID uuid.UUID, createdBy *uuid.UUID, err error)
}

// MiddlewareJWTOrCLI accepts a user JWT or a namespace-scoped CLI token (tfc_…).
func (h *Handler) MiddlewareJWTOrCLI(resolver CLITokenResolver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := bearerToken(r)
			if token == "" {
				httpx.WriteError(w, http.StatusUnauthorized, "missing or invalid authorization header")
				return
			}
			if strings.HasPrefix(token, "tfc_") {
				tokenID, nsID, createdBy, err := resolver.ResolveCLIToken(r.Context(), token)
				if err != nil {
					httpx.WriteError(w, http.StatusUnauthorized, "invalid or expired CLI token")
					return
				}
				cli := &CLIAuth{TokenID: tokenID, NamespaceID: nsID, CreatedBy: createdBy}
				ctx := context.WithValue(r.Context(), cliAuthKey, cli)
				claims := &Claims{
					Email:   "cli-token",
					IsAdmin: false,
				}
				if createdBy != nil {
					claims.UserID = *createdBy
				}
				ctx = context.WithValue(ctx, claimsKey, claims)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			claims, err := h.svc.ParseToken(token)
			if err != nil {
				httpx.WriteError(w, http.StatusUnauthorized, "invalid or expired token")
				return
			}
			ctx := context.WithValue(r.Context(), claimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
