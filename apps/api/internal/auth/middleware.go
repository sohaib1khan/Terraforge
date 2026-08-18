package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/terraforge/terraforge/apps/api/internal/httpx"
)

type ctxKey int

const claimsKey ctxKey = 1

func UserFromContext(ctx context.Context) *Claims {
	claims, _ := ctx.Value(claimsKey).(*Claims)
	return claims
}

func (h *Handler) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			httpx.WriteError(w, http.StatusUnauthorized, "missing or invalid authorization header")
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

func (h *Handler) RequireAdmin(next http.Handler) http.Handler {
	return h.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := UserFromContext(r.Context())
		if claims == nil || !claims.IsAdmin {
			httpx.WriteError(w, http.StatusForbidden, "admin access required")
			return
		}
		next.ServeHTTP(w, r)
	}))
}

func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if strings.HasPrefix(header, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	}
	// WebSocket clients often pass the token as a query param.
	return strings.TrimSpace(r.URL.Query().Get("token"))
}
