export interface TimeRemainingInfo {
  expired: boolean;
  urgent: boolean;
  label: string;
}

export function formatTimeRemaining(expiresAt: string, nowMs = Date.now()): TimeRemainingInfo {
  const targetMs = Date.parse(expiresAt);
  if (Number.isNaN(targetMs)) {
    return { expired: false, urgent: false, label: '3-day pool window' };
  }
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) {
    return { expired: true, urgent: true, label: 'Expired · Dissolving' };
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days >= 1) {
    return {
      expired: false,
      urgent: false,
      label: `${days}d ${hours}h left`,
    };
  }
  if (hours >= 1) {
    return {
      expired: false,
      urgent: hours < 6,
      label: `${hours}h ${minutes}m left`,
    };
  }
  return {
    expired: false,
    urgent: true,
    label: `${Math.max(1, minutes)}m left`,
  };
}
