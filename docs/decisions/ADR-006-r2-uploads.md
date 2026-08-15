# ADR-006: R2 for File Uploads

**Status**: Accepted

> **2026-08-15 erratum**: the real R2 key convention is `${userId}/${courseId}/${id}-${safeName}` (`src/lib/services/attachments.ts:20`, matches `docs/api.md`) — not `attachments/{userId}/{courseSlug}/{filename}` as the "Decision"/"Upload Flow" sections below describe (no `attachments/` prefix, keyed by course **id** not slug, and the filename is sanitized + UUID-prefixed rather than used verbatim). The "File Type Filtering"/MIME validation and "Size limit: 10 MB per file, 100 MB per course" claims below did **not** ship as described either: there is no MIME allow/deny list anywhere in the code, and only the per-file 10 MB cap is real — enforced via `MAX_ATTACHMENT_BYTES` in `src/lib/schemas/attachments.ts` (landed 2026-08-15), checked against `file.size` before the file is buffered, failing with `400 invalid_input` over the limit. There is no per-course 100 MB aggregate cap.

**Decision**: Use Cloudflare R2 for storing course attachments (PDFs, images, notes).

## Context

studyus allows students to upload materials to courses (study guides, lecture notes, problem solutions). We need:
- Scalable storage (not database blobs).
- Fast streaming (download large PDFs quickly).
- Course & user isolation (no cross-course leaks).
- Cleanup on course deletion.

Alternatives:
- **Local filesystem**: Can't scale; Workers are stateless.
- **AWS S3**: Works, but R2 is cheaper and colocated.
- **Database blobs**: Performance + size limits.

## Decision

**Cloudflare R2** for all file uploads:
- Binding in `wrangler.jsonc`: `UPLOADS`.
- Endpoint: `POST /api/v1/courses/:id/attachments` (multipart form).
- Key structure: `attachments/{userId}/{courseSlug}/{filename}`.
- Metadata: `attachments` table tracks R2 keys + metadata.

## Upload Flow

1. Client sends file via `multipart/form-data`.
2. Validate file: size limit (10 MB), MIME type (PDF, image, etc.).
3. Generate R2 key: `attachments/{userId}/{courseSlug}/{filename}`.
4. Stream to R2 via Workers API.
5. Insert row in `attachments` table (user_id, course_id, r2_key, filename, mime_type, file_size).
6. Return `attachment_id` to client.

## Download & Deletion

### Download
```
GET /attachments/:id
→ Query attachments table, fetch from R2, stream to client with correct MIME type.
```

### Deletion
```
DELETE /attachments/:id
→ Delete from attachments table AND R2.
```

## Access Control

- R2 is accessed only from Workers (not publicly).
- Every download query checks `user_id` (only owner can access).
- Attachment row is scoped to course → course access controls apply.

## Cleanup

When a course is archived:
- Don't delete attachments (preserve history).
- When fully deleted (post-v1):
  - Run cleanup job: delete all attachments for that course from R2.

## Consequences

**Positive:**
- Unlimited storage (R2 scales).
- Fast downloads (R2 is geographically distributed).
- Cost-effective (<$0.015/GB stored, $0.04/million requests).
- Integrates seamlessly with Workers.

**Negative:**
- Extra D1 table (`attachments`) for metadata.
- Cleanup requires coordination (file + DB record).
- No automatic versioning (overwrite = loss; post-v1 versioning if needed).

## File Type Filtering

v1 allows:
- **Documents**: PDF, DOCX, XLSX, PPTX, TXT, Markdown.
- **Images**: PNG, JPG, GIF (thumbnails post-v1).
- **Archives**: ZIP (for homework bundles).

Block: executables, scripts, archives with code.

## Security

- **File upload validation**: Check MIME type + magic bytes (not just extension).
- **Size limit**: 10 MB per file, 100 MB per course.
- **Virus scanning**: Post-v1 (via R2 events + external scanner).
- **No code execution**: R2 serves files, never executes.

## TODO

- Thumbnail generation for images (R2 image optimization).
- Virus scanning via R2 events webhook.
- Versioning (allow multiple versions of the same filename).
- Bandwidth optimization (cache headers, compression).
