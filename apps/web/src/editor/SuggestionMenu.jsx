import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { exitSuggestion } from '@tiptap/suggestion';

/**
 * One popover for every "type a character, pick from a list" menu (`/` blocks,
 * `@` dates). Items run their own command.
 * @typedef {{
 *   title: string,
 *   subtext?: string,
 *   group?: string,
 *   icon?: string,
 *   aliases?: string[],
 *   run: (editor: import('@tiptap/core').Editor, range: import('@tiptap/core').Range) => void,
 * }} MenuItem
 */

/**
 * @param {{
 *   name: string,
 *   char: string,
 *   items: (query: string, editor: import('@tiptap/core').Editor) => MenuItem[],
 *   allowSpaces?: boolean,
 * }} opts
 */
export function suggestionMenu({ name, char, items, allowSpaces = false }) {
  const pluginKey = new PluginKey(name);
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          pluginKey,
          char,
          allowSpaces,
          // Not inside code, and not inside other suggestions' text.
          allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
          items: ({ query, editor }) => items(query, editor),
          command: ({ editor, range, props }) => /** @type {MenuItem} */ (props).run(editor, range),
          render: () => {
            /** @type {ReactRenderer<MenuHandle, MenuProps> | null} */
            let renderer = null;
            /** @type {(() => void) | null} */
            let unmount = null;
            return {
              onStart: (props) => {
                renderer = new ReactRenderer(Menu, { props, editor: props.editor });
                renderer.element.classList.add('papier-popover-host');
                unmount = props.mount(/** @type {HTMLElement} */ (renderer.element));
              },
              onUpdate: (props) => renderer?.updateProps(props),
              onKeyDown: ({ event, view }) => {
                if (event.key === 'Escape') {
                  exitSuggestion(view, pluginKey);
                  return true;
                }
                return renderer?.ref?.onKeyDown(event) ?? false;
              },
              onExit: () => {
                unmount?.();
                renderer?.destroy();
                renderer?.element.remove();
                renderer = null;
              },
            };
          },
        }),
      ];
    },
  });
}

/** @typedef {{ onKeyDown: (event: KeyboardEvent) => boolean }} MenuHandle */
/** @typedef {{ items: MenuItem[], command: (item: MenuItem) => void, ref?: import('react').Ref<MenuHandle> }} MenuProps */

/** @param {MenuProps} props */
function Menu({ items, command, ref }) {
  const [selected, setSelected] = useState(0);
  const list = useRef(/** @type {HTMLDivElement | null} */ (null));

  useEffect(() => setSelected(0), [items]);
  useEffect(() => {
    list.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (!items.length) return false; // nothing to pick: Enter etc. behave normally
      if (event.key === 'ArrowDown') {
        setSelected((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowUp') {
        setSelected((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (!items.length) return null;

  return (
    <div
      ref={list}
      role="listbox"
      className="papier-popover max-h-[320px] w-[260px] overflow-y-auto p-1"
      onMouseDown={(e) => e.preventDefault()} // keep focus in the editor
    >
      {items.map((item, i) => {
        const header = item.group && item.group !== items[i - 1]?.group;
        return (
          <div key={`${item.group}-${item.title}-${i}`}>
            {header && <div className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">{item.group}</div>}
            <button
              type="button"
              role="option"
              aria-selected={i === selected}
              data-selected={i === selected}
              onMouseEnter={() => setSelected(i)}
              onClick={() => command(item)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left data-[selected=true]:bg-hover"
            >
              {item.icon && (
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded border border-line text-[12px] text-muted">
                  {item.icon}
                </span>
              )}
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[14px] text-fg">{item.title}</span>
                {item.subtext && <span className="truncate text-[12px] text-faint">{item.subtext}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
