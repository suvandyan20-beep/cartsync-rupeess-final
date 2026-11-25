import { useState } from 'react';
import { ArrowLeft, CalendarCheck2, Check, Ban, Save } from 'lucide-react';
import type { AvailabilitySlot } from '../types.ts';

interface AvailabilitySchedulerProps {
  slots: AvailabilitySlot[];
  recommendedWindow: string;
  onSaveSlots: (
    updated: { dayOfWeek: string; slotLabel: string; status: 'available' | 'unavailable'; note: string }[]
  ) => Promise<void>;
  onBack?: () => void;
}

const DAYS: AvailabilitySlot['dayOfWeek'][] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIME_SLOTS: AvailabilitySlot['slotLabel'][] = [
  'Morning (8am–12pm)',
  'Afternoon (12pm–4pm)',
  'Evening (4pm–8pm)',
];

export function AvailabilityScheduler({
  slots,
  recommendedWindow,
  onSaveSlots,
  onBack,
}: AvailabilitySchedulerProps) {
  const [localMap, setLocalMap] = useState<Map<string, { status: 'available' | 'unavailable'; note: string }>>(() => {
    const map = new Map<string, { status: 'available' | 'unavailable'; note: string }>();
    for (const s of slots) {
      map.set(`${s.dayOfWeek}__${s.slotLabel}`, { status: s.status, note: s.note });
    }
    return map;
  });
  const [defaultNote, setDefaultNote] = useState(() => {
    const firstWithNote = slots.find((s) => s.note.trim().length > 0);
    return firstWithNote?.note || 'Leave parcel inside covered porch or ring intercom.';
  });
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  function toggleSlot(day: string, slotLabel: string) {
    const key = `${day}__${slotLabel}`;
    setSavedMsg(null);
    setLocalMap((prev) => {
      const next = new Map(prev);
      const current = next.get(key) || { status: 'unavailable', note: '' };
      next.set(key, {
        status: current.status === 'available' ? 'unavailable' : 'available',
        note: current.status === 'unavailable' ? defaultNote : '',
      });
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setSavedMsg(null);
    try {
      const payload = [];
      for (const day of DAYS) {
        for (const slotLabel of TIME_SLOTS) {
          const entry = localMap.get(`${day}__${slotLabel}`) || { status: 'unavailable' as const, note: '' };
          payload.push({
            dayOfWeek: day,
            slotLabel,
            status: entry.status,
            note: entry.status === 'available' ? defaultNote : '',
          });
        }
      }
      await onSaveSlots(payload);
      setSavedMsg('Delivery availability schedule saved. Upcoming combined deliveries will sync to these windows.');
    } finally {
      setSaving(false);
    }
  }

  const availableCount = Array.from(localMap.values()).filter((v) => v.status === 'available').length;

  return (
    <div className="space-y-8 animate-fade-in">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#24152F] hover:text-[#FF783D] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          <span>Back to Profile</span>
        </button>
      )}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b-2 border-[#E6D8CB] pb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] font-extrabold text-[#FF783D] mb-1">
            Delivery Preferences
          </div>
          <h1 className="font-display text-3xl font-extrabold text-[#24152F]">
            Delivery Availability Schedule
          </h1>
          <p className="text-sm text-[#5E5468] mt-1.5 max-w-2xl">
            Mark when you are home to receive combined or normal parcels. CartSync assigns deliveries to your open slots and shares your preferred window with sellers.
          </p>
        </div>

        <div className="p-4 rounded-2xl border-2 border-[#24152F] bg-[#FFFFFF] shadow-card flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-[#D9F36A] text-[#24152F] flex items-center justify-center shrink-0">
            <CalendarCheck2 className="w-5 h-5" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] font-extrabold text-[#5E5468]">
              Next Auto-Matched Window
            </div>
            <div className="text-sm font-extrabold text-[#24152F]">{recommendedWindow}</div>
          </div>
        </div>
      </div>

      {/* Interactive 7x3 Availability Matrix */}
      <div className="border-2 border-[#E6D8CB] rounded-2xl overflow-x-auto bg-[#FFFFFF] shadow-card">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="bg-[#24152F] text-[#FFFFFF] border-b-2 border-[#24152F]">
              <th className="text-left px-5 py-3.5 text-xs font-extrabold text-[#D9F36A] w-48">
                Time Window
              </th>
              {DAYS.map((day) => (
                <th key={day} className="text-center px-3 py-3.5 text-xs font-extrabold text-[#FFFFFF]">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E6D8CB]">
            {TIME_SLOTS.map((slotLabel) => (
              <tr key={slotLabel}>
                <td className="px-5 py-4 font-bold text-[#24152F] whitespace-nowrap">{slotLabel}</td>
                {DAYS.map((day) => {
                  const state = localMap.get(`${day}__${slotLabel}`)?.status || 'unavailable';
                  const isAvailable = state === 'available';
                  return (
                    <td key={`${day}_${slotLabel}`} className="p-2 text-center">
                      <button
                        type="button"
                        onClick={() => toggleSlot(day, slotLabel)}
                        className={`w-full py-2.5 px-2 rounded-xl border-2 text-xs font-extrabold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                          isAvailable
                            ? 'bg-[#D9F36A] border-[#24152F] text-[#24152F] hover:bg-[#C6E548]'
                            : 'bg-[#FFF8F0] border-[#E6D8CB] text-[#5E5468] hover:border-[#24152F] hover:text-[#24152F]'
                        }`}
                      >
                        {isAvailable ? (
                          <>
                            <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />
                            <span>Available</span>
                          </>
                        ) : (
                          <>
                            <Ban className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                            <span>Away</span>
                          </>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Drop-off Note & Save */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-2xl p-6 shadow-card">
        <div className="lg:col-span-8">
          <label className="block text-xs font-extrabold text-[#24152F] mb-2">
            Courier Drop-Off Instructions (applied to available windows)
          </label>
          <input
            type="text"
            value={defaultNote}
            onChange={(e) => setDefaultNote(e.target.value)}
            placeholder="e.g. Ring intercom #4B after 5pm or leave with building concierge"
            className="w-full px-4 py-2.5 text-sm bg-[#FFF8F0] border-2 border-[#E6D8CB] text-[#29232F] placeholder:text-[#5E5468] rounded-xl focus:outline-none focus:border-[#FF783D]"
          />
        </div>
        <div className="lg:col-span-4 flex items-center justify-between lg:justify-end gap-4">
          <span className="text-xs font-bold text-[#5E5468] tabular-nums">
            {availableCount} / 21 slots open
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <Save className="w-4 h-4" strokeWidth={2} />
            <span>{saving ? 'Saving...' : 'Save Availability'}</span>
          </button>
        </div>
      </div>

      {savedMsg && (
        <div className="p-4 rounded-2xl bg-[#ECFCCB] border-2 border-[#24152F] text-xs font-bold text-[#24152F]">
          {savedMsg}
        </div>
      )}
    </div>
  );
}
