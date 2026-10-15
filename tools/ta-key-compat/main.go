// ta-key-compat is a local decoder and PEM encoding normalizer for the
// Diag4.1 manual Keybox worker. It never bypasses the Rust keybox validator.
package main

import (
	"bytes"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
)

const maxInput = 4 << 20
const maxOutput = 1 << 20

var legacyPEM = regexp.MustCompile(`(?s)-----BEGIN (EC|RSA) PRIVATE KEY-----.*?-----END (?:EC|RSA) PRIVATE KEY-----`)

func boundedRead(path string) ([]byte, error) {
	info, e := os.Stat(path)
	if e != nil {
		return nil, e
	}
	if info.Size() > maxInput {
		return nil, errors.New("input exceeds 4 MiB")
	}
	return os.ReadFile(path)
}
func decode64(b []byte) ([]byte, error) {
	clean := strings.Join(strings.Fields(string(b)), "")
	return base64.StdEncoding.DecodeString(clean)
}
func normalizeXml(b []byte) ([]byte, error) {
	if len(b) < 20 || len(b) > maxOutput {
		return nil, errors.New("decoded size outside allowed 20 B–1 MiB")
	}
	dec := xml.NewDecoder(bytes.NewReader(b))
	var root string
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, fmt.Errorf("invalid XML: %w", err)
		}
		if s, ok := tok.(xml.StartElement); ok {
			root = s.Name.Local
			break
		}
	}
	if root != "AndroidAttestation" {
		return nil, errors.New("decoded data is not an AndroidAttestation XML document")
	}
	return b, nil
}
func rot13(b []byte) []byte {
	c := append([]byte(nil), b...)
	for i, v := range c {
		switch {
		case v >= 'a' && v <= 'z':
			c[i] = 'a' + (v-'a'+13)%26
		case v >= 'A' && v <= 'Z':
			c[i] = 'A' + (v-'A'+13)%26
		}
	}
	return c
}
func decode(source string, raw []byte) ([]byte, error) {
	var b []byte
	var err error
	switch source {
	case "daredevil":
		b = raw
	case "yurikey":
		b, err = decode64(raw)
	case "upstream":
		var h []byte
		h, err = hex.DecodeString(strings.Join(strings.Fields(string(raw)), ""))
		if err != nil {
			break
		}
		b, err = decode64(h)
	case "meowdump":
		b = bytes.TrimSpace(raw)
		for i := 1; i <= 10; i++ {
			b, err = decode64(b)
			if err != nil {
				return nil, fmt.Errorf("base64 layer %d of 10: %w", i, err)
			}
		}
		b, err = hex.DecodeString(strings.Join(strings.Fields(string(b)), ""))
		if err != nil {
			break
		}
		b = rot13(b)
	default:
		return nil, errors.New("unknown keybox source")
	}
	if err != nil {
		return nil, err
	}
	return normalizeXml(b)
}
func normalize(src []byte) ([]byte, int, error) {
	converted := 0
	var failure error
	out := legacyPEM.ReplaceAllFunc(src, func(m []byte) []byte {
		if failure != nil {
			return m
		}
		block, extra := pem.Decode(m)
		if block == nil || len(bytes.TrimSpace(extra)) != 0 {
			failure = errors.New("malformed legacy PEM block")
			return m
		}
		var key any
		var err error
		switch block.Type {
		case "EC PRIVATE KEY":
			key, err = x509.ParseECPrivateKey(block.Bytes)
		case "RSA PRIVATE KEY":
			key, err = x509.ParsePKCS1PrivateKey(block.Bytes)
		default:
			return m
		}
		if err != nil {
			failure = err
			return m
		}
		der, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			failure = err
			return m
		}
		converted++
		return bytes.TrimRight(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), "\n")
	})
	if failure != nil {
		return nil, 0, failure
	}
	if _, err := normalizeXml(out); err != nil {
		return nil, 0, err
	}
	return out, converted, nil
}
func run(args []string) error {
	if len(args) != 4 {
		return errors.New("usage: ta-key-compat decode SOURCE INPUT OUTPUT | normalize - INPUT OUTPUT")
	}
	action, source, in, out := args[0], args[1], args[2], args[3]
	raw, err := boundedRead(in)
	if err != nil {
		return err
	}
	var result []byte
	var count int
	switch action {
	case "decode":
		result, err = decode(source, raw)
	case "normalize":
		if source != "-" {
			return errors.New("normalize requires -")
		}
		result, count, err = normalize(raw)
	default:
		return errors.New("invalid action")
	}
	if err != nil {
		return err
	}
	if err = os.WriteFile(out, result, 0600); err != nil {
		return err
	}
	if action == "decode" {
		fmt.Printf("decoded=%d\n", len(result))
	} else {
		fmt.Printf("converted=%d\n", count)
	}
	return nil
}
func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "decode/normalize error:", err)
		os.Exit(1)
	}
}