/**
 * ClipboardImport — the §10.4 "Import from Clipboard" control (DESIGN §10.4, §8.6
 * 한국어 아이템 붙여넣기, §10.9 Korean/English clipboard auto-detect).
 *
 * A paste textarea + an import button: the host owns the parse (via
 * {@link useItemsTab}'s `importFromClipboard`), this component just collects the
 * pasted text and hands it up through `onImport`. When the host passes the parsed
 * result back down as `imported`, it is rendered through the {@link ItemInspector}
 * so parsed and unsupported affix lines appear split, each with the icon+text badge
 * (§8.6 step 4, §11.3 — meaning never colour-only).
 *
 * Pure text only (DESIGN §14.2 "item paste parser는 순수 텍스트만 처리"): the textarea
 * carries the plain clipboard string; no HTML clipboard is touched here. All chrome
 * resolves through the i18n resolver `t` (§8.1).
 */
import { useState } from 'react';
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import { ItemInspector } from './ItemInspector.js';
import type { InspectedItem } from './ItemInspector.js';

export interface ClipboardImportProps {
  /** Active locale, drives every label. */
  locale: Locale;
  /** Called with the pasted text when the import button is pressed. */
  onImport: (text: string) => void;
  /** The parsed result to render through the inspector (set by the host once parsed). */
  imported?: InspectedItem;
}

export function ClipboardImport({ locale, onImport, imported }: ClipboardImportProps) {
  const [text, setText] = useState('');
  const label = t(locale, 'items.clipboard.pasteLabel');

  return (
    <div className="pob-clipboard-import" data-clipboard-import>
      <label className="pob-clipboard-import__field">
        <span className="pob-clipboard-import__label">{label}</span>
        <textarea
          className="pob-clipboard-import__textarea"
          aria-label={label}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>

      <button type="button" className="pob-clipboard-import__button" onClick={() => onImport(text)}>
        {t(locale, 'items.importFromClipboard')}
      </button>

      {imported ? (
        <div className="pob-clipboard-import__result" data-clipboard-result>
          <ItemInspector locale={locale} item={imported} />
        </div>
      ) : null}
    </div>
  );
}
