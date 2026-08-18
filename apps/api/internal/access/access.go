package access

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/auth"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
	"github.com/terraforge/terraforge/apps/api/internal/members"
)

type Checker struct {
	Members *members.Service
}

func (c *Checker) Require(w http.ResponseWriter, r *http.Request, namespaceID uuid.UUID, min members.Role) bool {
	if cli := auth.CLIFromContext(r.Context()); cli != nil {
		if cli.NamespaceID != namespaceID {
			httpx.WriteError(w, http.StatusForbidden, "CLI token not valid for this namespace")
			return false
		}
		// CLI tokens are writer-scoped: cannot perform admin-only actions.
		if min == members.RoleAdmin {
			httpx.WriteError(w, http.StatusForbidden, "insufficient permissions")
			return false
		}
		return true
	}
	claims := auth.UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return false
	}
	err := c.Members.Require(r.Context(), namespaceID, claims.UserID, claims.IsAdmin, min)
	if errors.Is(err, members.ErrForbidden) || errors.Is(err, members.ErrNotFound) {
		httpx.WriteError(w, http.StatusForbidden, "insufficient permissions")
		return false
	}
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "permission check failed")
		return false
	}
	return true
}

func Claims(ctx context.Context) *auth.Claims {
	return auth.UserFromContext(ctx)
}
