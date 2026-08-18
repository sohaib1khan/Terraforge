package auth

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestHashAndCheckPassword(t *testing.T) {
	hash, err := HashPassword("super-secret")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !CheckPassword(hash, "super-secret") {
		t.Fatal("expected password to match")
	}
	if CheckPassword(hash, "wrong") {
		t.Fatal("expected wrong password to fail")
	}
}

func TestIssueAndParseToken(t *testing.T) {
	svc := NewService(nil, "test-secret", time.Hour)
	user := User{
		ID:      uuid.New(),
		Email:   "admin@example.com",
		IsAdmin: true,
	}
	token, expiresAt, err := svc.IssueToken(user)
	if err != nil {
		t.Fatalf("IssueToken: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}
	if time.Until(expiresAt) < 50*time.Minute {
		t.Fatalf("unexpected expiry: %v", expiresAt)
	}

	claims, err := svc.ParseToken(token)
	if err != nil {
		t.Fatalf("ParseToken: %v", err)
	}
	if claims.UserID != user.ID || claims.Email != user.Email || !claims.IsAdmin {
		t.Fatalf("claims mismatch: %+v", claims)
	}
}

func TestValidateCredentials(t *testing.T) {
	if err := validateCredentials("bad", "password1"); err == nil {
		t.Fatal("expected invalid email")
	}
	if err := validateCredentials("a@b.co", "short"); err == nil {
		t.Fatal("expected short password error")
	}
	if err := validateCredentials("a@b.co", "longenough"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
