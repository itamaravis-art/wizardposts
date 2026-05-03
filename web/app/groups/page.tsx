'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import type { Group } from '@/lib/types';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Dialog } from '@/components/ui/Dialog';
import { Tooltip } from '@/components/ui/Tooltip';

import { toast } from '@/lib/toast';
import {
  Plus,
  Trash,
  Edit,
  Search,
  Users,
  ExternalLink,
  Check,
  X,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
} from '@/lib/icons';

type SortKey = 'name' | 'tag' | 'success_count' | 'fail_count' | 'last_posted_at' | 'created_at';
type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 50;

function isValidGroupUrl(u: string): boolean {
  return /facebook\.com\/groups\//i.test(u.trim());
}

function successRate(g: Group): number | null {
  const total = g.success_count + g.fail_count;
  if (total === 0) return null;
  return Math.round((g.success_count / total) * 100);
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  // filters & sort
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);

  // selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // inline edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editTag, setEditTag] = useState('');

  // dialogs
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number[] | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  async function load(showSkeleton = true) {
    if (showSkeleton) setLoading(true);
    try {
      const data = await apiGet<Group[]>('/api/groups');
      setGroups(data);
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בטעינת הקבוצות');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const tags = useMemo(() => {
    const s = new Set<string>();
    groups.forEach((g) => g.tag && s.add(g.tag));
    return Array.from(s).sort();
  }, [groups]);

  const filtered = useMemo(() => {
    let out = groups;
    if (activeFilter !== 'all') {
      const want = activeFilter === 'active' ? 1 : 0;
      out = out.filter((g) => g.active === want);
    }
    if (tagFilter) out = out.filter((g) => g.tag === tagFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      out = out.filter(
        (g) =>
          (g.name ?? '').toLowerCase().includes(s) ||
          g.url.toLowerCase().includes(s) ||
          (g.tag ?? '').toLowerCase().includes(s)
      );
    }
    const sorted = [...out].sort((a, b) => {
      const va = a[sortKey] ?? '';
      const vb = b[sortKey] ?? '';
      if (va === vb) return 0;
      const cmp = va > vb ? 1 : -1;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [groups, activeFilter, tagFilter, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, tagFilter, activeFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  // selection
  const allOnPageSelected =
    pageItems.length > 0 && pageItems.every((g) => selected.has(g.id));
  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        pageItems.forEach((g) => next.delete(g.id));
      } else {
        pageItems.forEach((g) => next.add(g.id));
      }
      return next;
    });
  }
  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  // inline edit
  function startEdit(g: Group) {
    setEditingId(g.id);
    setEditName(g.name ?? '');
    setEditTag(g.tag ?? '');
  }
  async function saveEdit(id: number) {
    setBusyAction(true);
    try {
      await apiPatch(`/api/groups/${id}`, {
        name: editName || null,
        tag: editTag || null,
      });
      toast.success('הקבוצה עודכנה');
      setEditingId(null);
      setGroups((prev) =>
        prev.map((g) =>
          g.id === id ? { ...g, name: editName || null, tag: editTag || null } : g
        )
      );
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בעדכון');
    } finally {
      setBusyAction(false);
    }
  }

  async function toggleActive(g: Group) {
    const next = g.active === 1 ? 0 : 1;
    setGroups((prev) =>
      prev.map((x) => (x.id === g.id ? { ...x, active: next as 0 | 1 } : x))
    );
    try {
      await apiPatch(`/api/groups/${g.id}`, { active: next });
      toast.success(next === 1 ? 'הקבוצה הופעלה' : 'הקבוצה הושבתה');
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בעדכון');
      setGroups((prev) =>
        prev.map((x) => (x.id === g.id ? { ...x, active: g.active } : x))
      );
    }
  }

  // bulk operations
  async function bulkSetActive(active: 0 | 1) {
    if (selected.size === 0) return;
    setBusyAction(true);
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          apiPatch(`/api/groups/${id}`, { active })
        )
      );
      toast.success(`עודכנו ${selected.size} קבוצות`);
      clearSelection();
      load(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בעדכון מרובה');
    } finally {
      setBusyAction(false);
    }
  }

  async function bulkDelete(ids: number[]) {
    setBusyAction(true);
    try {
      await Promise.all(ids.map((id) => apiDelete(`/api/groups/${id}`)));
      toast.success(`נמחקו ${ids.length} קבוצות`);
      setConfirmDelete(null);
      clearSelection();
      load(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה במחיקה');
    } finally {
      setBusyAction(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold">קבוצות</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            נהל את ספריית הקבוצות שלך — סנן, חפש, ערוך ופעולות מרובות.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setBulkOpen(true)}>
            ייבוא בכמות
          </Button>
          <Button icon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
            הוסף קבוצה
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card padded className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם, קישור או תגית..."
            icon={<Search size={16} />}
            className="flex-1 min-w-[16rem]"
          />
          <Select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            aria-label="סינון לפי תגית"
          >
            <option value="">כל התגיות</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <div className="flex rounded-lg border border-slate-200 dark:border-border overflow-hidden text-sm">
            {(['all', 'active', 'inactive'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setActiveFilter(v)}
                className={cn(
                  'px-3 h-9 transition-colors',
                  activeFilter === v
                    ? 'bg-brand-600 text-white'
                    : 'bg-white dark:bg-surface text-slate-700 dark:text-foreground hover:bg-slate-50 dark:hover:bg-surface-2'
                )}
              >
                {v === 'all' ? 'הכל' : v === 'active' ? 'פעילות' : 'לא פעילות'}
              </button>
            ))}
          </div>
          <div className="text-xs text-slate-500 mr-auto tabular-nums">
            מציג {pageItems.length} מתוך {filtered.length}
            {filtered.length !== groups.length && ` (סך הכל ${groups.length})`}
          </div>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 p-2 bg-brand-50 dark:bg-brand-950/30 rounded-lg border border-brand-200 dark:border-brand-900 animate-in fade-in slide-in-from-top-1">
            <Badge variant="primary">{selected.size} נבחרו</Badge>
            <Button
              size="sm"
              variant="secondary"
              icon={<Check size={14} />}
              onClick={() => bulkSetActive(1)}
              loading={busyAction}
            >
              הפעל
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<X size={14} />}
              onClick={() => bulkSetActive(0)}
              loading={busyAction}
            >
              השבת
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash size={14} />}
              onClick={() => setConfirmDelete(Array.from(selected))}
            >
              מחק נבחרים
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection} className="mr-auto">
              נקה בחירה
            </Button>
          </div>
        )}
      </Card>

      {/* Body */}
      {loading ? (
        <Card padded className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </Card>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="עדיין לא הוספת קבוצות"
          description="כדי לפרסם בקבוצות פייסבוק צריך להוסיף אותן לספרייה. אפשר לייבא הרבה בבת אחת."
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setBulkOpen(true)}>
                ייבוא בכמות
              </Button>
              <Button icon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
                הוסף קבוצה
              </Button>
            </div>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={28} />}
          title="אין תוצאות לסינון"
          description="נסה לנקות את הסינון או החיפוש."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('');
                setTagFilter('');
                setActiveFilter('all');
              }}
            >
              נקה סינון
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-surface-2 text-slate-600 dark:text-muted-foreground border-b border-slate-200 dark:border-border">
                <tr>
                  <th className="w-10 p-3">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleSelectPage}
                      aria-label="בחר הכל"
                      className="w-4 h-4 cursor-pointer"
                    />
                  </th>
                  <SortHeader label="שם" k="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="text-right p-3 font-semibold">קישור</th>
                  <SortHeader label="תגית" k="tag" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortHeader label="הצלחות" k="success_count" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortHeader label="כשלונות" k="fail_count" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="text-right p-3 font-semibold">הצלחה</th>
                  <SortHeader
                    label="פורסם לאחרונה"
                    k="last_posted_at"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="text-right p-3 font-semibold">פעיל</th>
                  <th className="text-left p-3 font-semibold">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((g) => {
                  const isEdit = editingId === g.id;
                  const isSelected = selected.has(g.id);
                  const rate = successRate(g);
                  return (
                    <tr
                      key={g.id}
                      className={cn(
                        'border-b border-slate-100 dark:border-border last:border-0 transition-colors',
                        isSelected && 'bg-brand-50/50 dark:bg-brand-950/20',
                        !isSelected && 'hover:bg-slate-50 dark:hover:bg-surface-2'
                      )}
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleOne(g.id)}
                          aria-label={`בחר ${g.name ?? g.url}`}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </td>
                      <td className="p-3 max-w-[16rem]">
                        {isEdit ? (
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="שם תצוגה"
                            autoFocus
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(g)}
                            className="text-right truncate font-medium hover:text-brand-600 dark:hover:text-brand-400 transition-colors max-w-full"
                            title={g.name ?? '—'}
                          >
                            {g.name || <span className="text-slate-400 italic">ללא שם</span>}
                          </button>
                        )}
                      </td>
                      <td className="p-3 max-w-[20rem]">
                        <a
                          href={g.url}
                          target="_blank"
                          rel="noreferrer"
                          dir="ltr"
                          className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline truncate max-w-full"
                          title={g.url}
                        >
                          <span className="truncate">{g.url}</span>
                          <ExternalLink size={12} className="shrink-0" />
                        </a>
                      </td>
                      <td className="p-3">
                        {isEdit ? (
                          <Input
                            value={editTag}
                            onChange={(e) => setEditTag(e.target.value)}
                            placeholder="תגית"
                            className="w-28"
                          />
                        ) : g.tag ? (
                          <Badge variant="secondary">{g.tag}</Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-3 tabular-nums text-emerald-700 dark:text-emerald-400">
                        {g.success_count}
                      </td>
                      <td className="p-3 tabular-nums text-red-700 dark:text-red-400">
                        {g.fail_count}
                      </td>
                      <td className="p-3">
                        {rate === null ? (
                          <span className="text-slate-400 text-xs">—</span>
                        ) : (
                          <Badge
                            variant={
                              rate >= 80 ? 'success' : rate >= 50 ? 'warning' : 'danger'
                            }
                          >
                            {rate}%
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 text-xs text-slate-500 whitespace-nowrap">
                        {g.last_posted_at ? formatRelative(g.last_posted_at) : '—'}
                      </td>
                      <td className="p-3">
                        <Switch
                          checked={g.active === 1}
                          onCheckedChange={() => toggleActive(g)}
                          aria-label="פעיל"
                        />
                      </td>
                      <td className="p-3 text-left whitespace-nowrap">
                        {isEdit ? (
                          <div className="flex gap-1 justify-end">
                            <Tooltip content="שמור">
                              <Button
                                size="sm"
                                variant="primary"
                                icon={<Check size={14} />}
                                onClick={() => saveEdit(g.id)}
                                loading={busyAction}
                                aria-label="שמור"
                              />
                            </Tooltip>
                            <Tooltip content="ביטול">
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<X size={14} />}
                                onClick={() => setEditingId(null)}
                                aria-label="ביטול"
                              />
                            </Tooltip>
                          </div>
                        ) : (
                          <div className="flex gap-1 justify-end">
                            <Tooltip content="ערוך">
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Edit size={14} />}
                                onClick={() => startEdit(g)}
                                aria-label="ערוך"
                              />
                            </Tooltip>
                            <Tooltip content="מחק">
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Trash size={14} />}
                                onClick={() => setConfirmDelete([g.id])}
                                className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                aria-label="מחק"
                              />
                            </Tooltip>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-border bg-slate-50 dark:bg-surface-2">
              <span className="text-xs text-slate-500 tabular-nums">
                עמוד {page} מתוך {totalPages}
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ChevronRight size={14} />}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  aria-label="קודם"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ChevronLeft size={14} />}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  aria-label="הבא"
                />
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Add Group Dialog */}
      <AddGroupDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          load(false);
        }}
      />

      {/* Bulk import Dialog */}
      <BulkImportDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        existingUrls={groups.map((g) => g.url)}
        onSaved={() => {
          setBulkOpen(false);
          load(false);
        }}
      />

      {/* Delete confirm */}
      <Dialog
        open={confirmDelete !== null}
        onClose={() => !busyAction && setConfirmDelete(null)}
        title={
          confirmDelete && confirmDelete.length > 1
            ? `מחיקת ${confirmDelete.length} קבוצות`
            : 'מחיקת קבוצה'
        }
        description="הקבוצה תוסר ולא תשתתף בקמפיינים עתידיים. נתוני קמפיינים קיימים נשמרים."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={busyAction}>
              ביטול
            </Button>
            <Button
              variant="danger"
              icon={<Trash size={16} />}
              onClick={() => confirmDelete && bulkDelete(confirmDelete)}
              loading={busyAction}
            >
              מחק
            </Button>
          </>
        }
      />
    </div>
  );
}

function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th className="text-right p-3 font-semibold">
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-foreground transition-colors',
          active && 'text-slate-900 dark:text-foreground'
        )}
      >
        {label}
        {active && (
          <span className="text-xs">{sortDir === 'asc' ? '▲' : '▼'}</span>
        )}
      </button>
    </th>
  );
}

function AddGroupDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ url?: string }>({});

  // Reset on close
  useEffect(() => {
    if (!open) {
      setUrl('');
      setName('');
      setTag('');
      setErrors({});
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      setErrors({ url: 'יש להזין קישור' });
      return;
    }
    if (!isValidGroupUrl(url)) {
      setErrors({ url: 'הקישור חייב להיות של קבוצת פייסבוק' });
      return;
    }
    setBusy(true);
    try {
      await apiPost('/api/groups', {
        url: url.trim(),
        name: name.trim() || undefined,
        tag: tag.trim() || undefined,
      });
      toast.success('הקבוצה נוספה');
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בהוספה');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="הוספת קבוצה">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="text-sm font-medium block mb-1.5">
            קישור לקבוצה <span className="text-red-500">*</span>
          </label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.facebook.com/groups/..."
            dir="ltr"
            error={errors.url}
            autoFocus
          />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1.5">שם תצוגה</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1.5">תגית</label>
          <Input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="למשל: רכב, נדל״ן, עבודה..."
          />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-border">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ביטול
          </Button>
          <Button type="submit" loading={busy}>
            הוסף
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function BulkImportDialog({
  open,
  onClose,
  onSaved,
  existingUrls,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  existingUrls: string[];
}) {
  const [text, setText] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setText('');
      setTag('');
    }
  }, [open]);

  const stats = useMemo(() => {
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const dupesIncoming = new Set<string>();
    const valid: string[] = [];
    const invalid: string[] = [];
    const existing = new Set(existingUrls);
    const dupesExisting: string[] = [];
    for (const u of lines) {
      if (seen.has(u)) {
        dupesIncoming.add(u);
        continue;
      }
      seen.add(u);
      if (!isValidGroupUrl(u)) {
        invalid.push(u);
      } else if (existing.has(u)) {
        dupesExisting.push(u);
      } else {
        valid.push(u);
      }
    }
    return {
      total: lines.length,
      valid: valid.length,
      invalid: invalid.length,
      duplicates: dupesIncoming.size + dupesExisting.length,
      validUrls: valid,
    };
  }, [text, existingUrls]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (stats.valid === 0) {
      toast.error('אין קישורים תקינים לייבוא');
      return;
    }
    setBusy(true);
    try {
      await apiPost('/api/groups/bulk', {
        urls: stats.validUrls,
        tag: tag.trim() || undefined,
      });
      toast.success(`יובאו ${stats.valid} קבוצות`);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בייבוא');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="ייבוא בכמות" size="lg">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="text-sm font-medium block mb-1.5">
            קישורים — אחד בכל שורה
          </label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            dir="ltr"
            className="font-mono text-sm"
            placeholder={
              'https://www.facebook.com/groups/123\nhttps://www.facebook.com/groups/456'
            }
          />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1.5">
            תגית משותפת <span className="text-slate-400">(אופציונלי)</span>
          </label>
          <Input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="התגית תוחל על כל הקישורים"
          />
        </div>

        {stats.total > 0 && (
          <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 dark:bg-surface-2 rounded-lg text-sm">
            <div className="text-center">
              <div className="text-xs text-slate-500">תקינים</div>
              <div className="text-lg font-semibold text-emerald-600 tabular-nums">
                {stats.valid}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500">לא תקינים</div>
              <div
                className={cn(
                  'text-lg font-semibold tabular-nums',
                  stats.invalid > 0 ? 'text-red-600' : 'text-slate-400'
                )}
              >
                {stats.invalid}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500">כפילויות</div>
              <div
                className={cn(
                  'text-lg font-semibold tabular-nums',
                  stats.duplicates > 0 ? 'text-amber-600' : 'text-slate-400'
                )}
              >
                {stats.duplicates}
              </div>
            </div>
          </div>
        )}

        {stats.invalid > 0 && (
          <div className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span>קישורים לא תקינים יידלגו אוטומטית. רק קישורי קבוצות פייסבוק תקפים.</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-border">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ביטול
          </Button>
          <Button type="submit" loading={busy} disabled={stats.valid === 0}>
            ייבא {stats.valid > 0 ? `${stats.valid} קבוצות` : ''}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
