<script lang="ts">
  type Attachment = {
    id: string;
    filename: string;
    contentType: string | null;
    sizeBytes: number | null;
  };

  let { courseId, initialAttachments }: { courseId: string; initialAttachments: Attachment[] } = $props();

  let attachments = $state<Attachment[]>(initialAttachments);
  let uploading = $state(false);
  let dragOver = $state(false);
  let error = $state<string | null>(null);

  function formatSize(bytes: number | null): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async function upload(file: File) {
    error = null;
    uploading = true;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/v1/courses/${courseId}/attachments`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        error = json?.error?.message ?? 'Upload failed';
        return;
      }
      attachments = [
        ...attachments,
        {
          id: json.data.attachment_id,
          filename: json.data.filename,
          contentType: json.data.mime_type,
          sizeBytes: file.size,
        },
      ];
    } catch {
      error = 'Network error, please try again.';
    } finally {
      uploading = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) upload(file);
  }

  function onFileInput(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) upload(file);
    (e.target as HTMLInputElement).value = '';
  }

  async function remove(id: string) {
    if (!confirm('Delete this attachment?')) return;
    const res = await fetch(`/api/v1/attachments/${id}`, { method: 'DELETE' });
    if (res.ok) attachments = attachments.filter((a) => a.id !== id);
  }
</script>

<div class="attachments">
  <ul class="list">
    {#each attachments as a (a.id)}
      <li>
        <a href={`/api/v1/attachments/${a.id}`} target="_blank" rel="noopener">{a.filename}</a>
        <span class="meta">{formatSize(a.sizeBytes)}</span>
        <button type="button" class="delete" onclick={() => remove(a.id)}>Delete</button>
      </li>
    {/each}
    {#if attachments.length === 0}
      <li class="empty">No attachments yet.</li>
    {/if}
  </ul>

  <div
    class="dropzone"
    class:drag={dragOver}
    role="button"
    tabindex="0"
    ondragover={(e) => {
      e.preventDefault();
      dragOver = true;
    }}
    ondragleave={() => (dragOver = false)}
    ondrop={onDrop}
  >
    {#if uploading}
      <p>Uploading…</p>
    {:else}
      <p>
        Drag a file here, or
        <label class="file-label">
          browse
          <input type="file" onchange={onFileInput} hidden />
        </label>
      </p>
    {/if}
  </div>
  {#if error}<p class="error">{error}</p>{/if}
</div>

<style>
  .attachments {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
  }
  .list li.empty {
    color: var(--muted, #6b7280);
    border-style: dashed;
  }
  .list a { color: var(--accent, #3f6fd8); text-decoration: none; flex: 1; }
  .meta { font-size: 0.78rem; color: var(--muted, #6b7280); }
  .delete {
    background: none;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    padding: 0.2rem 0.55rem;
    font-size: 0.78rem;
    cursor: pointer;
    color: #b91c1c;
  }
  .dropzone {
    border: 1.5px dashed var(--border, #e5e7eb);
    border-radius: 10px;
    padding: 1.5rem;
    text-align: center;
    color: var(--muted, #6b7280);
    font-size: 0.9rem;
  }
  .dropzone.drag { border-color: var(--accent, #3f6fd8); background: #f5f8ff; }
  .file-label { color: var(--accent, #3f6fd8); cursor: pointer; text-decoration: underline; }
  .error { color: #b91c1c; font-size: 0.85rem; margin: 0; }
</style>
