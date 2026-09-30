import { useEffect, useRef, useState } from 'react';
import { NodeSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';

/** @typedef {import('@tiptap/core').Editor} Editor */

const MARKS = /** @type {const} */ ([
  { mark: 'bold', label: 'B', title: 'Bold (Ctrl+B)', className: 'font-bold' },
  { mark: 'italic', label: 'I', title: 'Italic (Ctrl+I)', className: 'italic font-serif' },
  { mark: 'underline', label: 'U', title: 'Underline (Ctrl+U)', className: 'underline' },
  { mark: 'strike', label: 'S', title: 'Strikethrough (Ctrl+Shift+S)', className: 'line-through' },
  { mark: 'code', label: '</>', title: 'Inline code (Ctrl+E)', className: 'font-mono text-[12px]' },
]);

/**
 * Floating toolbar over a text selection: marks + link. Ctrl/Cmd-K opens the
 * link field directly.
 * @param {{ editor: Editor }} props
 */
export function FormatToolbar({ editor }) {
  const [linking, setLinking] = useState(false);
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      href: /** @type {string} */ (e.getAttributes('link').href ?? ''),
    }),
  });

  // Ctrl/Cmd-K over a selection: straight to the link field.
  useEffect(() => {
    const dom = editor.view.dom;
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !editor.state.selection.empty) {
        e.preventDefault();
        setLinking(true);
      }
    };
    dom.addEventListener('keydown', onKey);
    return () => dom.removeEventListener('keydown', onKey);
  }, [editor]);

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ state, from, to }) => {
        if (from === to || state.selection instanceof NodeSelection || !editor.isEditable) return false;
        return !state.doc.resolve(from).parent.type.spec.code;
      }}
      options={{ placement: 'top', offset: 8, onHide: () => setLinking(false) }}
      className="papier-popover z-30 flex items-center gap-0.5 p-1"
    >
      {linking ? (
        <LinkField
          initial={active.href}
          onDone={(href) => {
            const chain = editor.chain().focus().extendMarkRange('link');
            (href ? chain.setLink({ href: normalizeHref(href) }) : chain.unsetLink()).run();
            setLinking(false);
          }}
          onCancel={() => {
            setLinking(false);
            editor.commands.focus();
          }}
        />
      ) : (
        <>
          {MARKS.map(({ mark, label, title, className }) => (
            <ToolButton
              key={mark}
              title={title}
              active={active[mark]}
              onClick={() => editor.chain().focus().toggleMark(mark).run()}
            >
              <span className={className}>{label}</span>
            </ToolButton>
          ))}
          <span className="mx-0.5 h-5 w-px bg-line" />
          <ToolButton title="Link (Ctrl+K)" active={active.link} onClick={() => setLinking(true)}>
            Link
          </ToolButton>
        </>
      )}
    </BubbleMenu>
  );
}

/** Bare domains get https://; anything with a scheme (or mailto:) is left alone. @param {string} href */
function normalizeHref(href) {
  const h = href.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('/') || h.startsWith('#') ? h : `https://${h}`;
}

/** @param {{ title: string, active: boolean, onClick: () => void, children: import('react').ReactNode }} props */
function ToolButton({ title, active, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()} // keep the selection
      onClick={onClick}
      className={`flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-[13px] hover:bg-hover ${
        active ? 'text-accent-text' : 'text-fg'
      }`}
    >
      {children}
    </button>
  );
}

/** @param {{ initial: string, onDone: (href: string) => void, onCancel: () => void }} props */
function LinkField({ initial, onDone, onCancel }) {
  const [value, setValue] = useState(initial);
  const input = useRef(/** @type {HTMLInputElement | null} */ (null));
  useEffect(() => input.current?.focus(), []);

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(value);
      }}
    >
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Paste or type a link…"
        aria-label="Link address"
        className="h-7 w-[220px] rounded bg-transparent px-2 text-[13px] text-fg outline-none placeholder:text-faint"
      />
      {initial && (
        <button type="button" onClick={() => onDone('')} className="h-7 rounded px-2 text-[12px] text-muted hover:bg-hover">
          Remove
        </button>
      )}
    </form>
  );
}
