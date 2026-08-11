<script lang="ts">
  interface Link {
    course_id?: string;
    kc_id?: string;
  }

  interface Note {
    id: string;
    title: string;
    content: string;
    updated_at: string;
    links: Link[];
  }

  interface CourseWithKcs {
    id: string;
    code: string;
    title: string;
    kcs: Array<{ id: string; name: string }>;
  }

  interface Props {
    note: Note;
    coursesWithKcs: CourseWithKcs[];
    noteId: string;
  }

  let { note, coursesWithKcs, noteId } = $props();

  let title = $state(note.title);
  let content = $state(note.content);
  let links = $state<Link[]>(note.links);

  let showLinkPicker = $state(false);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let saveSuccess = $state(false);
  let unsavedChanges = $state(false);

  interface MarkdownElement {
    type: string;
    text?: string;
    items?: string[];
  }

  function parseMarkdown(md: string): MarkdownElement[] {
    const elements: MarkdownElement[] = [];
    const lines = md.split('\n');
    let inList = false;
    let listItems: string[] = [];

    for (const line of lines) {
      if (line.startsWith('# ')) {
        if (inList) {
          elements.push({ type: 'list', items: listItems });
          listItems = [];
          inList = false;
        }
        elements.push({ type: 'h1', text: line.substring(2) });
      } else if (line.startsWith('## ')) {
        if (inList) {
          elements.push({ type: 'list', items: listItems });
          listItems = [];
          inList = false;
        }
        elements.push({ type: 'h2', text: line.substring(3) });
      } else if (line.startsWith('### ')) {
        if (inList) {
          elements.push({ type: 'list', items: listItems });
          listItems = [];
          inList = false;
        }
        elements.push({ type: 'h3', text: line.substring(4) });
      } else if (line.startsWith('- ')) {
        inList = true;
        listItems.push(line.substring(2));
      } else if (line.trim() === '') {
        if (inList) {
          elements.push({ type: 'list', items: listItems });
          listItems = [];
          inList = false;
        }
      } else {
        if (inList) {
          elements.push({ type: 'list', items: listItems });
          listItems = [];
          inList = false;
        }
        elements.push({ type: 'paragraph', text: line });
      }
    }

    if (inList) {
      elements.push({ type: 'list', items: listItems });
    }

    return elements;
  }

  function handleTitleChange(e: Event) {
    title = (e.target as HTMLInputElement).value;
    unsavedChanges = true;
  }

  function handleContentChange(e: Event) {
    content = (e.target as HTMLTextAreaElement).value;
    unsavedChanges = true;
  }

  async function saveNote() {
    if (!unsavedChanges) return;

    saving = true;
    saveError = null;
    saveSuccess = false;

    try {
      const res = await fetch(`/api/v1/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content,
          links,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        saveError = json?.error?.message ?? 'Failed to save note';
        return;
      }

      unsavedChanges = false;
      saveSuccess = true;
      setTimeout(() => (saveSuccess = false), 2000);
    } catch (err) {
      saveError = 'Network error, please try again.';
    } finally {
      saving = false;
    }
  }

  function addLink(courseId?: string, kcId?: string) {
    if (!courseId && !kcId) return;
    links = [...links, { course_id: courseId, kc_id: kcId }];
    unsavedChanges = true;
  }

  function removeLink(index: number) {
    links = links.filter((_, i) => i !== index);
    unsavedChanges = true;
  }

  function handleContentBlur() {
    if (unsavedChanges) saveNote();
  }
</script>

<div class="editor-container">
  <div class="editor-main">
    <input
      type="text"
      class="title-input"
      bind:value={title}
      onchange={handleTitleChange}
      placeholder="Note title"
    />

    <div class="markdown-editor">
      <textarea
        class="markdown-input"
        bind:value={content}
        onchange={handleContentChange}
        onblur={handleContentBlur}
        placeholder="Write your note here... Markdown supported."
      ></textarea>
      <div class="markdown-preview">
        <div class="preview-content">
          {#each parseMarkdown(content) as element}
            {#if element.type === 'h1'}
              <h1>{element.text}</h1>
            {:else if element.type === 'h2'}
              <h2>{element.text}</h2>
            {:else if element.type === 'h3'}
              <h3>{element.text}</h3>
            {:else if element.type === 'list'}
              <ul>
                {#each element.items as item}
                  <li>{item}</li>
                {/each}
              </ul>
            {:else if element.type === 'paragraph'}
              <p>{element.text}</p>
            {/if}
          {/each}
        </div>
      </div>
    </div>

    <div class="editor-footer">
      <button
        class="btn-primary"
        onclick={saveNote}
        disabled={!unsavedChanges || saving}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>

      {#if saveSuccess}
        <span class="success-message">Saved</span>
      {/if}

      {#if saveError}
        <span class="error-message">{saveError}</span>
      {/if}
    </div>
  </div>

  <div class="editor-sidebar">
    <div class="links-section">
      <h3>Links</h3>
      <button class="btn-secondary" onclick={() => (showLinkPicker = !showLinkPicker)}>
        {showLinkPicker ? 'Hide' : 'Add links'}
      </button>

      {#if showLinkPicker}
        <LinkPicker {coursesWithKcs} onAdd={addLink} />
      {/if}

      {#if links.length > 0}
        <div class="links-list">
          {#each links as link, idx}
            <div class="link-item">
              {#if link.course_id}
                <span class="link-badge course">{link.course_id}</span>
              {/if}
              {#if link.kc_id}
                <span class="link-badge kc">{link.kc_id}</span>
              {/if}
              <button class="btn-remove" onclick={() => removeLink(idx)}>×</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .editor-container {
    display: grid;
    grid-template-columns: 1fr 220px;
    gap: 2rem;
    margin-top: 1.5rem;
  }

  .editor-main {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .title-input {
    font-size: 1.5rem;
    font-weight: 600;
    border: none;
    border-bottom: 2px solid #e5e7eb;
    padding: 0.5rem 0;
    font-family: inherit;
  }

  .title-input:focus {
    outline: none;
    border-bottom-color: #3f6fd8;
  }

  .markdown-editor {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    height: 500px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
  }

  .markdown-input,
  .markdown-preview {
    display: flex;
    flex-direction: column;
  }

  .markdown-input {
    font-family: 'Courier New', monospace;
    font-size: 0.9rem;
    padding: 1rem;
    border: none;
    border-right: 1px solid #e5e7eb;
    resize: none;
  }

  .markdown-input:focus {
    outline: none;
  }

  .markdown-preview {
    background: #fafafa;
    overflow-y: auto;
  }

  .preview-content {
    padding: 1rem;
    font-size: 0.95rem;
    line-height: 1.6;
  }

  .preview-content h1,
  .preview-content h2,
  .preview-content h3 {
    margin: 1rem 0 0.5rem 0;
  }

  .preview-content h1 {
    font-size: 1.8rem;
  }

  .preview-content h2 {
    font-size: 1.4rem;
  }

  .preview-content h3 {
    font-size: 1.1rem;
  }

  .preview-content p {
    margin: 0.5rem 0;
  }

  .preview-content code {
    background: #f3f4f6;
    padding: 0.2rem 0.4rem;
    border-radius: 3px;
    font-family: 'Courier New', monospace;
  }

  .preview-content ul {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .editor-footer {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .btn-primary,
  .btn-secondary {
    background: #3f6fd8;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 0.65rem 1rem;
    font-size: 0.9rem;
    cursor: pointer;
    font-weight: 500;
  }

  .btn-primary:hover:not(:disabled),
  .btn-secondary:hover {
    background: #3460c5;
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .btn-secondary {
    background: #6b7280;
  }

  .btn-secondary:hover {
    background: #4b5563;
  }

  .success-message {
    color: #059669;
    font-size: 0.9rem;
  }

  .error-message {
    color: #991b1b;
    font-size: 0.9rem;
  }

  .editor-sidebar {
    display: flex;
    flex-direction: column;
  }

  .links-section {
    background: #fafafa;
    padding: 1rem;
    border-radius: 8px;
  }

  .links-section h3 {
    margin-top: 0;
    font-size: 0.9rem;
  }

  .links-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .link-item {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem;
    background: white;
    border-radius: 4px;
    font-size: 0.85rem;
  }

  .link-badge {
    padding: 0.3rem 0.6rem;
    border-radius: 3px;
    font-weight: 500;
    flex: 1;
  }

  .link-badge.course {
    background: #dbeafe;
    color: #1e40af;
  }

  .link-badge.kc {
    background: #ddd6fe;
    color: #6d28d9;
  }

  .btn-remove {
    background: none;
    border: none;
    color: #9ca3af;
    cursor: pointer;
    font-size: 1.2rem;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-remove:hover {
    color: #ef4444;
  }

  @media (max-width: 960px) {
    .editor-container {
      grid-template-columns: 1fr;
    }

    .markdown-editor {
      grid-template-columns: 1fr;
      height: auto;
      max-height: 600px;
    }

    .markdown-input {
      border-right: none;
      border-bottom: 1px solid #e5e7eb;
      height: 300px;
    }

    .markdown-preview {
      height: 300px;
    }
  }
</style>
