"""
Property-based tests for the Secure_Temporary_Storage_Service (Req 51).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hypothesis property tests covering the encryption round-trip of the secure
temporary storage service (`app/analysis_v2/storage/secure_temp_storage.py`):

  • Property 60 — Secure temporary storage is an encryption round-trip:
    for any Temporary_Artifact, the stored bytes differ from the plaintext and
    are not readable without the decryption key, while decrypting the stored
    bytes with the key reproduces the original artifact exactly (Req 51.1).

Run (from ai-service/):
    venv\\Scripts\\python.exe -m pytest \\
        app/analysis_v2/storage/test_secure_temp_storage_encryption_property.py
"""

from __future__ import annotations

import secrets

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis_v2.storage.secure_temp_storage import (
    _KEY_SIZE,
    SecureTemporaryStorageService,
    decrypt_bytes,
    encrypt_bytes,
)

# Minimum number of generated examples per property (task requirement: >= 100).
_MIN_ITER = 150

# Arbitrary plaintext artifact bytes, including the empty artifact.
_plaintext = st.binary(min_size=0, max_size=4096)
# Non-trivial (non-empty) plaintext, used where "ciphertext differs" is asserted.
_nonempty_plaintext = st.binary(min_size=1, max_size=4096)


# ── Property 60: encryption round-trip via the module-level primitives ──
@settings(max_examples=_MIN_ITER)
@given(plaintext=_plaintext, key=st.binary(min_size=_KEY_SIZE, max_size=_KEY_SIZE))
def test_encrypt_decrypt_round_trip_identity(plaintext: bytes, key: bytes) -> None:
    """`decrypt_bytes(key, encrypt_bytes(key, x)) == x` for arbitrary x.

    **Validates: Requirements 51.1**
    """
    blob = encrypt_bytes(key, plaintext)
    assert decrypt_bytes(key, blob) == plaintext


@settings(max_examples=_MIN_ITER)
@given(plaintext=_nonempty_plaintext, key=st.binary(min_size=_KEY_SIZE, max_size=_KEY_SIZE))
def test_ciphertext_at_rest_differs_from_plaintext(plaintext: bytes, key: bytes) -> None:
    """The encrypted blob is never equal to the (non-trivial) plaintext.

    The artifact is encrypted before it is readable, so the bytes at rest are
    not the plaintext (Req 51.1).

    **Validates: Requirements 51.1**
    """
    blob = encrypt_bytes(key, plaintext)
    assert blob != plaintext


@settings(max_examples=_MIN_ITER)
@given(plaintext=_nonempty_plaintext)
def test_wrong_key_fails_authentication(plaintext: bytes) -> None:
    """Decrypting with a wrong key raises rather than returning plaintext.

    The stored bytes are unreadable without the correct decryption key
    (Req 51.1).

    **Validates: Requirements 51.1**
    """
    key = secrets.token_bytes(_KEY_SIZE)
    wrong_key = secrets.token_bytes(_KEY_SIZE)
    # Guard against the astronomically unlikely collision of two random keys.
    if wrong_key == key:
        wrong_key = bytes((wrong_key[0] ^ 0xFF,)) + wrong_key[1:]

    blob = encrypt_bytes(key, plaintext)
    with pytest.raises(ValueError):
        result = decrypt_bytes(wrong_key, blob)
        # If no exception was raised, it must at least not be the plaintext.
        assert result != plaintext


# ── Property 60: encryption round-trip via the service ──
@settings(max_examples=_MIN_ITER)
@given(
    artifact_id=st.text(
        alphabet=st.characters(min_codepoint=48, max_codepoint=122),
        min_size=1,
        max_size=32,
    ),
    data=_nonempty_plaintext,
)
def test_service_write_read_round_trip(artifact_id: str, data: bytes) -> None:
    """Via the service: stored bytes differ from data, and read reproduces it.

    After `write`, the raw bytes at rest (`stored_bytes`) are not the original
    artifact, while `read` decrypts back to the original data exactly (Req 51.1).

    **Validates: Requirements 51.1**
    """
    service = SecureTemporaryStorageService()
    location = service.write(artifact_id, data)

    # Ciphertext-at-rest differs from the plaintext artifact.
    assert service.stored_bytes(location) != data
    # Round-trip identity through the service.
    assert service.read(location) == data


@settings(max_examples=_MIN_ITER)
@given(
    artifact_id=st.text(
        alphabet=st.characters(min_codepoint=48, max_codepoint=122),
        min_size=1,
        max_size=32,
    ),
    data=_nonempty_plaintext,
)
def test_service_stored_bytes_unreadable_without_key(artifact_id: str, data: bytes) -> None:
    """The bytes at rest cannot be decrypted with a different key.

    A separate service instance (different in-memory key) cannot recover the
    artifact from the stored ciphertext (Req 51.1).

    **Validates: Requirements 51.1**
    """
    service = SecureTemporaryStorageService()
    location = service.write(artifact_id, data)
    ciphertext = service.stored_bytes(location)

    other_key = secrets.token_bytes(_KEY_SIZE)
    if other_key == service.encryption_key:
        other_key = bytes((other_key[0] ^ 0xFF,)) + other_key[1:]

    with pytest.raises(ValueError):
        decrypt_bytes(other_key, ciphertext)
