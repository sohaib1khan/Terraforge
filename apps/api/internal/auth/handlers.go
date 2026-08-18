package auth

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/terraforge/terraforge/apps/api/internal/httpx"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/setup/status", h.SetupStatus)
	mux.HandleFunc("POST /api/setup", h.Setup)
	mux.HandleFunc("POST /api/auth/login", h.Login)
	mux.Handle("GET /api/auth/me", h.Middleware(http.HandlerFunc(h.Me)))
	mux.Handle("GET /api/users", h.RequireAdmin(http.HandlerFunc(h.ListUsers)))
	mux.Handle("POST /api/users", h.RequireAdmin(http.HandlerFunc(h.CreateUser)))
	mux.Handle("POST /api/users/{id}/reset-password", h.RequireAdmin(http.HandlerFunc(h.ResetPassword)))
	mux.Handle("POST /api/users/{id}/disable", h.RequireAdmin(http.HandlerFunc(h.DisableUser)))
	mux.Handle("POST /api/users/{id}/enable", h.RequireAdmin(http.HandlerFunc(h.EnableUser)))
}

type setupRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	User      User      `json:"user"`
}

func (h *Handler) SetupStatus(w http.ResponseWriter, r *http.Request) {
	needs, err := h.svc.NeedsSetup(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to check setup status")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"needs_setup": needs})
}

func (h *Handler) Setup(w http.ResponseWriter, r *http.Request) {
	var req setupRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	user, err := h.svc.CreateFirstAdmin(r.Context(), req.Email, req.Password)
	if err != nil {
		switch {
		case errors.Is(err, ErrSetupComplete):
			httpx.WriteError(w, http.StatusConflict, "setup already complete")
		case errors.Is(err, ErrValidation):
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
		default:
			httpx.WriteError(w, http.StatusInternalServerError, "failed to create admin")
		}
		return
	}

	token, expiresAt, err := h.svc.IssueToken(user)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to issue token")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, authResponse{
		Token:     token,
		ExpiresAt: expiresAt,
		User:      user,
	})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	user, err := h.svc.Authenticate(r.Context(), req.Email, req.Password)
	if err != nil {
		if errors.Is(err, ErrDisabled) {
			httpx.WriteError(w, http.StatusForbidden, "account disabled")
			return
		}
		if errors.Is(err, ErrInvalidCreds) {
			httpx.WriteError(w, http.StatusUnauthorized, "invalid email or password")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "login failed")
		return
	}

	token, expiresAt, err := h.svc.IssueToken(user)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to issue token")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, authResponse{
		Token:     token,
		ExpiresAt: expiresAt,
		User:      user,
	})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	claims := UserFromContext(r.Context())
	if claims == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	user, err := h.svc.GetUser(r.Context(), claims.UserID)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load user")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, user)
}

type createUserRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	IsAdmin  bool   `json:"is_admin"`
}

func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.svc.ListUsers(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list users")
		return
	}
	if users == nil {
		users = []User{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (h *Handler) CreateUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	user, err := h.svc.CreateUser(r.Context(), CreateUserInput{
		Email:    req.Email,
		Password: req.Password,
		IsAdmin:  req.IsAdmin,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrValidation):
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, ErrConflict):
			httpx.WriteError(w, http.StatusConflict, err.Error())
		default:
			httpx.WriteError(w, http.StatusInternalServerError, "failed to create user")
		}
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, user)
}

type resetPasswordRequest struct {
	Password string `json:"password"`
}

func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var req resetPasswordRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.svc.ResetPassword(r.Context(), id, req.Password); err != nil {
		switch {
		case errors.Is(err, ErrValidation):
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, ErrUserNotFound):
			httpx.WriteError(w, http.StatusNotFound, "user not found")
		default:
			httpx.WriteError(w, http.StatusInternalServerError, "failed to reset password")
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DisableUser(w http.ResponseWriter, r *http.Request) {
	h.setDisabled(w, r, true)
}

func (h *Handler) EnableUser(w http.ResponseWriter, r *http.Request) {
	h.setDisabled(w, r, false)
}

func (h *Handler) setDisabled(w http.ResponseWriter, r *http.Request, disabled bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	claims := UserFromContext(r.Context())
	if claims != nil && claims.UserID == id && disabled {
		httpx.WriteError(w, http.StatusBadRequest, "cannot disable your own account")
		return
	}
	user, err := h.svc.SetDisabled(r.Context(), id, disabled)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "user not found")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "failed to update user")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, user)
}
