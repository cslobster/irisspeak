import { useState, useEffect } from 'react';
import type { Dyad } from '../types';

interface Props {
  dyad?: Dyad;
  onSave: (data: Partial<Dyad & { login_code: string }>) => Promise<void>;
  onClose: () => void;
}

const GENDERS = ['girl', 'boy'] as const;
const PARENTS = ['mother', 'father'] as const;
const LOCALES = ['en', 'kr'] as const;

export function UserModal({ dyad, onSave, onClose }: Props) {
  const isEdit = !!dyad;
  const [alias, setAlias] = useState(dyad?.alias ?? '');
  const [childName, setChildName] = useState(dyad?.child_name ?? '');
  const [childGender, setChildGender] = useState<'girl' | 'boy'>(dyad?.child_gender ?? 'girl');
  const [parentType, setParentType] = useState<'mother' | 'father'>(dyad?.parent_type ?? 'mother');
  const [locale, setLocale] = useState<'en' | 'kr'>(dyad?.locale ?? 'en');
  const [loginCode, setLoginCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!isEdit && (!alias || !childName || !loginCode)) {
      setError('All fields are required'); return;
    }
    setSaving(true); setError('');
    try {
      const data: Partial<Dyad & { login_code: string }> = {
        alias, child_name: childName, child_gender: childGender,
        parent_type: parentType, locale,
      };
      if (loginCode) data.login_code = loginCode;
      await onSave(data);
      onClose();
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8">
        <h2 className="text-2xl font-extrabold text-slate-800 mb-6">{isEdit ? 'Edit User' : 'Add User'}</h2>

        {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2 font-semibold">{error}</p>}

        <div className="flex flex-col gap-4">
          <Field label="Username (alias)">
            <input value={alias} onChange={e => setAlias(e.target.value)}
              className="input" placeholder="e.g. sammy_family" />
          </Field>

          <Field label="Child name">
            <input value={childName} onChange={e => setChildName(e.target.value)}
              className="input" placeholder="e.g. Sammy" />
          </Field>

          <Field label="Child gender">
            <SegmentedControl options={GENDERS} value={childGender} onChange={v => setChildGender(v as any)} />
          </Field>

          <Field label="Parent type">
            <SegmentedControl options={PARENTS} value={parentType} onChange={v => setParentType(v as any)} />
          </Field>

          <Field label="Locale">
            <SegmentedControl options={LOCALES} value={locale} onChange={v => setLocale(v as any)} />
          </Field>

          <Field label={isEdit ? 'New login code (leave blank to keep)' : 'Login code'}>
            <input value={loginCode} onChange={e => setLoginCode(e.target.value)}
              className="input" placeholder={isEdit ? 'Enter new code to change' : 'e.g. 12345'} />
          </Field>
        </div>

        <div className="flex gap-3 mt-8">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-bold text-base hover:bg-slate-50 transition">
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-base transition">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function SegmentedControl({ options, value, onChange }: { options: readonly string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)}
          className={`flex-1 py-2 rounded-lg text-sm font-bold capitalize transition border-2 ${
            value === o ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'
          }`}>
          {o}
        </button>
      ))}
    </div>
  );
}
