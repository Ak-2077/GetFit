"""
V2 secure temporary storage (additive).

Secure_Temporary_Storage_Service (Stage 50, Req 51) encrypts transient
working data at rest and securely deletes it on completion, replacing the
V1 transient working-dir behavior additively. No durable persistence of
video, frames, or pose images (privacy by construction).
"""
