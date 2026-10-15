package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"strings"
	"testing"
)

const sampleXML = "<AndroidAttestation><Keybox/></AndroidAttestation>"

func TestDecoders(t *testing.T) {
	raw := []byte(sampleXML)
	cases := map[string][]byte{"daredevil": raw, "yurikey": []byte(base64.StdEncoding.EncodeToString(raw))}
	b64 := base64.StdEncoding.EncodeToString(raw)
	cases["upstream"] = []byte(hex.EncodeToString([]byte(b64)))
	r := rot13(raw)
	meow := []byte(hex.EncodeToString(r))
	for i := 0; i < 10; i++ {
		meow = []byte(base64.StdEncoding.EncodeToString(meow))
	}
	cases["meowdump"] = meow
	for src, input := range cases {
		got, err := decode(src, input)
		if err != nil || !bytes.Equal(got, raw) {
			t.Fatalf("%s: %v, %q", src, err, got)
		}
	}
}
func TestSEC1Normalize(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	old := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der})
	xml := []byte("<AndroidAttestation><PrivateKey>" + string(old) + "</PrivateKey></AndroidAttestation>")
	out, n, err := normalize(xml)
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if !strings.Contains(string(out), "-----BEGIN PRIVATE KEY-----") || strings.Contains(string(out), "BEGIN EC PRIVATE KEY") {
		t.Fatal("PKCS#8 conversion failed")
	}
	again, n, err := normalize(out)
	if err != nil || n != 0 || !bytes.Equal(out, again) {
		t.Fatalf("idempotence failed: %d %v", n, err)
	}
}
func TestNonXmlRejected(t *testing.T) {
	_, err := decode("daredevil", []byte("<foo>private material</foo>"))
	if err == nil {
		t.Fatal("accepted non-attestation xml")
	}
}