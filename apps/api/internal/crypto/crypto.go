package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"
)

// Key loads a 32-byte AES key from SECRETS_KEY (raw, hex, or base64),
// or derives one from JWT_SECRET for local/dev when SECRETS_KEY is unset.
func Key() ([]byte, error) {
	if raw := strings.TrimSpace(os.Getenv("SECRETS_KEY")); raw != "" {
		if key, err := decodeKey(raw); err == nil {
			return key, nil
		}
		sum := sha256.Sum256([]byte(raw))
		return sum[:], nil
	}
	jwt := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if jwt == "" {
		return nil, fmt.Errorf("SECRETS_KEY or JWT_SECRET required for secret encryption")
	}
	sum := sha256.Sum256([]byte("terraforge-secrets:" + jwt))
	return sum[:], nil
}

func decodeKey(raw string) ([]byte, error) {
	if b, err := base64.StdEncoding.DecodeString(raw); err == nil && len(b) == 32 {
		return b, nil
	}
	if b, err := base64.RawStdEncoding.DecodeString(raw); err == nil && len(b) == 32 {
		return b, nil
	}
	if b, err := hex.DecodeString(raw); err == nil && len(b) == 32 {
		return b, nil
	}
	if len(raw) == 32 {
		return []byte(raw), nil
	}
	return nil, fmt.Errorf("unsupported key encoding")
}

func Seal(key, plaintext []byte) (ciphertext, nonce []byte, err error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}
	ciphertext = gcm.Seal(nil, nonce, plaintext, nil)
	return ciphertext, nonce, nil
}

func Open(key, ciphertext, nonce []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, ciphertext, nil)
}
