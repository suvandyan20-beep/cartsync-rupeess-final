import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity,
  ArrowLeft,
  Check,
  Copy,
  Link2,
  Mail,
  MessageSquare,
  Package,
  Plus,
  Send,
  ShoppingCart,
  ThumbsUp,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { formatINR } from '../utils/currency.ts';
import type {
  Product,
  SocialGroup,
  SocialGroupCategory,
  SocialGroupInvitation,
  User,
} from '../types.ts';

interface MyGroupsViewProps {
  currentUser: User;
  groups: SocialGroup[];
  invitations: SocialGroupInvitation[];
  products: Product[];
  demoUsers: User[];
  initialInviteCode?: string | null;
  onCreateGroup: (payload: {
    name: string;
    category: SocialGroupCategory;
    description: string;
  }) => Promise<string | null>;
  onJoinGroup: (codeOrLink: string) => Promise<string | null>;
  onRespondInvitation: (invitationId: string, action: 'accept' | 'decline') => Promise<string | null>;
  onMarkGroupRead: (groupId: string) => Promise<void>;
  onSendMessage: (groupId: string, body: string, productId?: string | null) => Promise<void>;
  onShareProduct: (groupId: string, productId: string, note: string) => Promise<void>;
  onToggleProductVote: (groupId: string, productId: string) => Promise<void>;
  onInviteMember: (
    groupId: string,
    payload: { targetUserId?: string; email?: string }
  ) => Promise<void>;
  onAddToCart: (product: Product, useGroupPrice: boolean, quantity?: number) => Promise<boolean>;
  onLogCartActivity: (groupId: string, productName: string) => Promise<void>;
  onSelectProduct: (productId: string) => void;
  onBackHome: () => void;
}

type GroupDetailTab = 'chat' | 'products' | 'activity';

const CATEGORIES: SocialGroupCategory[] = [
  'Family',
  'Friends',
  'Roommates',
  'Colleagues',
  'Neighbors',
  'Other',
];

function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diffMins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

function getCategoryStyles(category: SocialGroupCategory): string {
  switch (category) {
    case 'Family':
      return 'bg-[#D9F36A] text-[#24152F] border-[#24152F]';
    case 'Roommates':
      return 'bg-[#FF783D] text-[#24152F] border-[#24152F]';
    case 'Friends':
      return 'bg-[#BBA5D5] text-[#24152F] border-[#24152F]';
    case 'Neighbors':
      return 'bg-[#FFF8F0] text-[#24152F] border-[#FF783D]';
    default:
      return 'bg-[#F4EAE0] text-[#24152F] border-[#24152F]';
  }
}

export function MyGroupsView({
  currentUser,
  groups,
  invitations,
  products,
  demoUsers,
  initialInviteCode,
  onCreateGroup,
  onJoinGroup,
  onRespondInvitation,
  onMarkGroupRead,
  onSendMessage,
  onShareProduct,
  onToggleProductVote,
  onInviteMember,
  onAddToCart,
  onLogCartActivity,
  onSelectProduct,
  onBackHome,
}: MyGroupsViewProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    groups[0]?.id || null
  );
  const [detailTab, setDetailTab] = useState<GroupDetailTab>('chat');

  // Create group state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupCategory, setNewGroupCategory] = useState<SocialGroupCategory>('Family');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Join group state
  const [joinInput, setJoinInput] = useState(initialInviteCode || '');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // Chat composer state
  const [chatText, setChatText] = useState('');
  const [chatProductId, setChatProductId] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  // Share product form state
  const [shareProductId, setShareProductId] = useState(products[0]?.id || '');
  const [shareNote, setShareNote] = useState('');
  const [sharingProduct, setSharingProduct] = useState(false);

  // Invite member state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);

  useEffect(() => {
    if (initialInviteCode) {
      setJoinInput(initialInviteCode);
    }
  }, [initialInviteCode]);

  useEffect(() => {
    if (!shareProductId && products.length > 0) {
      setShareProductId(products[0].id);
    }
  }, [products, shareProductId]);

  useEffect(() => {
    if (groups.length === 0) {
      setSelectedGroupId(null);
      return;
    }
    if (!selectedGroupId || !groups.some((g) => g.id === selectedGroupId)) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, selectedGroupId]);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );

  // Mark selected group chat as read when viewing the Chat tab with unread messages
  useEffect(() => {
    if (activeGroup && detailTab === 'chat' && activeGroup.unreadCount > 0) {
      void onMarkGroupRead(activeGroup.id);
    }
  }, [activeGroup, detailTab, onMarkGroupRead]);

  const invitableCustomers = useMemo(() => {
    if (!activeGroup) return [];
    const memberIds = new Set(activeGroup.members.map((m) => m.userId));
    return demoUsers.filter(
      (u) => u.role === 'customer' && u.id !== currentUser.id && !memberIds.has(u.id)
    );
  }, [activeGroup, currentUser.id, demoUsers]);

  async function handleCopyInvite(code: string, asLink: boolean) {
    const value = asLink
      ? `${window.location.origin}/?invite=${encodeURIComponent(code)}`
      : code;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedCode(asLink ? `link-${code}` : `code-${code}`);
      setTimeout(() => setCopiedCode(null), 2200);
    } catch {
      setCopiedCode(asLink ? `link-${code}` : `code-${code}`);
      setTimeout(() => setCopiedCode(null), 2200);
    }
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    if (!newGroupName.trim()) {
      setCreateError('Please enter a group name.');
      return;
    }
    setCreateError(null);
    setCreating(true);
    try {
      const createdId = await onCreateGroup({
        name: newGroupName.trim(),
        category: newGroupCategory,
        description: newGroupDescription.trim(),
      });
      if (createdId) {
        setSelectedGroupId(createdId);
      }
      setNewGroupName('');
      setNewGroupDescription('');
      setShowCreateForm(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create group.');
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinSubmit(e: FormEvent) {
    e.preventDefault();
    if (!joinInput.trim()) {
      setJoinError('Enter an invite link or group code (for example: NEIGH-5501).');
      return;
    }
    setJoinError(null);
    setJoining(true);
    try {
      const joinedId = await onJoinGroup(joinInput.trim());
      if (joinedId) {
        setSelectedGroupId(joinedId);
        setJoinInput('');
      }
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Could not join group.');
    } finally {
      setJoining(false);
    }
  }

  async function handleSendChat(e: FormEvent) {
    e.preventDefault();
    if (!activeGroup) return;
    if (!chatText.trim() && !chatProductId) return;
    setSendingMsg(true);
    try {
      await onSendMessage(activeGroup.id, chatText.trim(), chatProductId || null);
      setChatText('');
      setChatProductId('');
    } finally {
      setSendingMsg(false);
    }
  }

  async function handleShareSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeGroup || !shareProductId) return;
    setSharingProduct(true);
    try {
      await onShareProduct(activeGroup.id, shareProductId, shareNote.trim());
      setShareNote('');
    } finally {
      setSharingProduct(false);
    }
  }

  async function handleInviteSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeGroup || !inviteEmail.trim()) return;
    setInviteError(null);
    setInviting(true);
    try {
      await onInviteMember(activeGroup.id, { email: inviteEmail.trim() });
      setInviteEmail('');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Could not send invite.');
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-[#24152F] text-[#FFFFFF] rounded-2xl border-2 border-[#24152F] shadow-card p-6 sm:p-7">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-2">
            <button
              type="button"
              onClick={onBackHome}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#BBA5D5] hover:text-[#D9F36A] cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2.2} />
              <span>Back to Marketplace</span>
            </button>

            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-[#FF783D] text-[#24152F] flex items-center justify-center border-2 border-[#D9F36A] shrink-0">
                <Users className="w-5 h-5" strokeWidth={2.2} />
              </span>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight">
                  My Shopping Groups
                </h1>
                <p className="text-xs sm:text-sm text-[#BBA5D5]">
                  Coordinate with family, roommates, and friends — share products, chat in real time, and sync orders.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Join via Code or Invitation Link */}
            <form onSubmit={handleJoinSubmit} className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-64">
                <Link2
                  className="w-4 h-4 text-[#5E5468] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  strokeWidth={2}
                />
                <input
                  type="text"
                  value={joinInput}
                  onChange={(e) => {
                    setJoinInput(e.target.value);
                    if (joinError) setJoinError(null);
                  }}
                  placeholder="Paste invite link or code (e.g. NEIGH-5501)"
                  aria-label="Group invite code or invitation link"
                  className="w-full pl-9 pr-3 py-2.5 text-xs font-semibold bg-[#FFF8F0] text-[#29232F] placeholder:text-[#5E5468] rounded-xl border-2 border-[#BBA5D5] focus:border-[#FF783D] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={joining}
                className="px-4 py-2.5 rounded-xl bg-[#D9F36A] hover:bg-[#C6E548] text-[#24152F] text-xs font-extrabold border-2 border-[#24152F] cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                {joining ? 'Joining...' : 'Join Group'}
              </button>
            </form>

            {/* Create Group Button */}
            <button
              type="button"
              onClick={() => {
                setShowCreateForm((prev) => !prev);
                setCreateError(null);
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#FF783D] hover:bg-[#F26324] text-[#24152F] text-xs font-extrabold border-2 border-[#D9F36A] cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" strokeWidth={2.4} />
              <span>Create Group</span>
            </button>
          </div>
        </div>

        {joinError && (
          <div className="mt-3 px-4 py-2.5 rounded-xl bg-[#C83E4D] text-[#FFFFFF] text-xs font-bold flex items-center justify-between gap-2">
            <span>{joinError}</span>
            <button
              type="button"
              onClick={() => setJoinError(null)}
              className="cursor-pointer"
              aria-label="Dismiss join error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Create Group Panel */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateSubmit}
          className="bg-[#FFFFFF] rounded-2xl border-2 border-[#24152F] shadow-card p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-extrabold text-[#24152F]">
                Create a Private Shopping Group
              </h2>
              <p className="text-xs text-[#5E5468]">
                A shareable invite code and invitation link will be generated automatically.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="p-1.5 rounded-lg text-[#5E5468] hover:text-[#24152F] cursor-pointer"
              aria-label="Close create group form"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-extrabold text-[#24152F] mb-1.5">
                Group Name *
              </label>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="e.g. Sharma Family Weekly Cart"
                className="w-full px-3.5 py-2.5 text-sm bg-[#FFF8F0] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#29232F] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold text-[#24152F] mb-1.5">
                Group Type
              </label>
              <select
                value={newGroupCategory}
                onChange={(e) => setNewGroupCategory(e.target.value as SocialGroupCategory)}
                className="w-full px-3.5 py-2.5 text-sm font-semibold bg-[#FFF8F0] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#29232F] focus:outline-none"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-[#24152F] mb-1.5">
                Purpose / Note (optional)
              </label>
              <input
                type="text"
                value={newGroupDescription}
                onChange={(e) => setNewGroupDescription(e.target.value)}
                placeholder="e.g. Monthly groceries & household refills"
                className="w-full px-3.5 py-2.5 text-sm bg-[#FFF8F0] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#29232F] focus:outline-none"
              />
            </div>
          </div>

          {createError && (
            <div className="text-xs font-bold text-[#C83E4D]">{createError}</div>
          )}

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 rounded-xl text-xs font-bold text-[#5E5468] hover:text-[#24152F] border-2 border-[#E6D8CB] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#FF783D] hover:bg-[#F26324] text-[#24152F] text-xs font-extrabold border-2 border-[#24152F] cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-4 h-4" strokeWidth={2.2} />
              <span>{creating ? 'Creating...' : 'Create & Open Group'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Pending Group Invitations */}
      {invitations.length > 0 && (
        <section
          aria-label="Pending Group Invitations"
          className="bg-[#FFF4EC] border-2 border-[#FF783D] rounded-2xl p-5 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-lg bg-[#FF783D] text-[#24152F] text-[11px] font-extrabold">
                {invitations.length} NEW
              </span>
              <h2 className="font-display text-base font-extrabold text-[#24152F]">
                Pending Group Invitations
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="bg-[#FFFFFF] border-2 border-[#24152F] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${getCategoryStyles(
                        inv.groupCategory
                      )}`}
                    >
                      {inv.groupCategory}
                    </span>
                    <span className="font-mono text-[11px] font-bold text-[#5E5468]">
                      {inv.inviteCode}
                    </span>
                  </div>
                  <div className="font-display text-sm font-extrabold text-[#24152F] truncate">
                    {inv.groupName}
                  </div>
                  <div className="text-xs text-[#5E5468]">
                    Invited by <strong className="text-[#24152F]">{inv.invitedByName}</strong> ·{' '}
                    {inv.memberCount} member{inv.memberCount === 1 ? '' : 's'}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busyInvitationId === inv.id}
                    onClick={async () => {
                      setBusyInvitationId(inv.id);
                      try {
                        const acceptedId = await onRespondInvitation(inv.id, 'accept');
                        if (acceptedId) setSelectedGroupId(acceptedId);
                      } finally {
                        setBusyInvitationId(null);
                      }
                    }}
                    className="px-3.5 py-2 rounded-xl bg-[#D9F36A] hover:bg-[#C6E548] text-[#24152F] text-xs font-extrabold border-2 border-[#24152F] cursor-pointer disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={busyInvitationId === inv.id}
                    onClick={async () => {
                      setBusyInvitationId(inv.id);
                      try {
                        await onRespondInvitation(inv.id, 'decline');
                      } finally {
                        setBusyInvitationId(null);
                      }
                    }}
                    className="px-3 py-2 rounded-xl bg-[#FFFFFF] hover:bg-[#FEE2E2] text-[#C83E4D] text-xs font-extrabold border-2 border-[#E6D8CB] cursor-pointer disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Main Groups Workspace */}
      {groups.length === 0 ? (
        <div className="bg-[#FFFFFF] border-2 border-[#24152F] rounded-2xl p-10 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#FFF8F0] border-2 border-[#24152F] flex items-center justify-center text-[#FF783D]">
            <Users className="w-7 h-7" strokeWidth={2} />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="font-display text-xl font-extrabold text-[#24152F]">
              No Shopping Groups Yet
            </h2>
            <p className="text-sm text-[#5E5468]">
              Create a private group for your family, roommates, or friends, or paste an invite code like{' '}
              <span className="font-mono font-bold text-[#24152F]">NEIGH-5501</span> above to join one.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF783D] hover:bg-[#F26324] text-[#24152F] text-xs font-extrabold border-2 border-[#24152F] cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Your First Group</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Sidebar: Group List */}
          <aside className="lg:col-span-4 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="font-display text-sm font-extrabold uppercase tracking-wider text-[#24152F]">
                Your Groups ({groups.length})
              </h2>
              <span className="text-[11px] font-semibold text-[#5E5468]">
                Demo code: <strong className="font-mono text-[#24152F]">NEIGH-5501</strong>
              </span>
            </div>

            <div className="space-y-2.5">
              {groups.map((grp) => {
                const isSelected = activeGroup?.id === grp.id;
                const lastMessage = grp.messages[grp.messages.length - 1];
                return (
                  <button
                    key={grp.id}
                    type="button"
                    onClick={() => {
                      setSelectedGroupId(grp.id);
                      if (grp.unreadCount > 0) {
                        void onMarkGroupRead(grp.id);
                      }
                    }}
                    className={`w-full text-left p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#24152F] text-[#FFFFFF] border-[#FF783D] shadow-card'
                        : 'bg-[#FFFFFF] text-[#29232F] border-[#E6D8CB] hover:border-[#24152F]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${getCategoryStyles(
                          grp.category
                        )}`}
                      >
                        {grp.category}
                      </span>

                      <div className="flex items-center gap-1.5">
                        {grp.unreadCount > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-[#FF783D] text-[#24152F] text-[10px] font-mono font-extrabold">
                            {grp.unreadCount} unread
                          </span>
                        )}
                        <span
                          className={`font-mono text-[10px] font-bold ${
                            isSelected ? 'text-[#BBA5D5]' : 'text-[#5E5468]'
                          }`}
                        >
                          {grp.inviteCode}
                        </span>
                      </div>
                    </div>

                    <div
                      className={`font-display text-base font-extrabold truncate ${
                        isSelected ? 'text-[#FFFFFF]' : 'text-[#24152F]'
                      }`}
                    >
                      {grp.name}
                    </div>

                    <div
                      className={`text-xs mt-1 truncate ${
                        isSelected ? 'text-[#BBA5D5]' : 'text-[#5E5468]'
                      }`}
                    >
                      {lastMessage
                        ? `${lastMessage.senderName.split(' ')[0]}: ${lastMessage.body}`
                        : grp.description}
                    </div>

                    <div
                      className={`mt-2.5 pt-2 border-t flex items-center justify-between text-[11px] font-bold ${
                        isSelected
                          ? 'border-[#352145] text-[#D9F36A]'
                          : 'border-[#F1E7DD] text-[#5E5468]'
                      }`}
                    >
                      <span>{grp.members.length} members</span>
                      <span>{grp.sharedProducts.length} shared items</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Right Workspace: Selected Group Details */}
          {activeGroup && (
            <section className="lg:col-span-8 bg-[#FFFFFF] border-2 border-[#24152F] rounded-2xl shadow-card overflow-hidden">
              {/* Group Workspace Header */}
              <div className="p-5 sm:p-6 bg-[#FFF8F0] border-b-2 border-[#E6D8CB] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2.5 py-0.5 rounded-md text-[11px] font-extrabold border ${getCategoryStyles(
                          activeGroup.category
                        )}`}
                      >
                        {activeGroup.category}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-md bg-[#24152F] text-[#D9F36A] font-mono text-[11px] font-bold">
                        Code: {activeGroup.inviteCode}
                      </span>
                      <span className="text-xs font-bold text-[#5E5468]">
                        {activeGroup.members.length} members
                      </span>
                    </div>

                    <h2 className="font-display text-xl sm:text-2xl font-extrabold text-[#24152F]">
                      {activeGroup.name}
                    </h2>
                    <p className="text-xs sm:text-sm text-[#5E5468]">
                      {activeGroup.description}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleCopyInvite(activeGroup.inviteCode, false)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#FFFFFF] hover:bg-[#ECFCCB] text-[#24152F] text-xs font-extrabold border-2 border-[#24152F] cursor-pointer"
                    >
                      {copiedCode === `code-${activeGroup.inviteCode}` ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#15803D]" />
                          <span>Code Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Code</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleCopyInvite(activeGroup.inviteCode, true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#FF783D] hover:bg-[#F26324] text-[#24152F] text-xs font-extrabold border-2 border-[#24152F] cursor-pointer"
                    >
                      {copiedCode === `link-${activeGroup.inviteCode}` ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Link Copied</span>
                        </>
                      ) : (
                        <>
                          <Link2 className="w-3.5 h-3.5" />
                          <span>Copy Invite Link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Group Feature Tabs */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDetailTab('chat')}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold border-2 transition-colors cursor-pointer ${
                      detailTab === 'chat'
                        ? 'bg-[#24152F] text-[#D9F36A] border-[#24152F]'
                        : 'bg-[#FFFFFF] text-[#24152F] border-[#E6D8CB] hover:border-[#24152F]'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Group Chat</span>
                    <span className="px-1.5 py-0.5 rounded bg-[#FF783D] text-[#24152F] font-mono text-[10px]">
                      {activeGroup.messages.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDetailTab('products')}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold border-2 transition-colors cursor-pointer ${
                      detailTab === 'products'
                        ? 'bg-[#24152F] text-[#D9F36A] border-[#24152F]'
                        : 'bg-[#FFFFFF] text-[#24152F] border-[#E6D8CB] hover:border-[#24152F]'
                    }`}
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>Shared Products</span>
                    <span className="px-1.5 py-0.5 rounded bg-[#BBA5D5] text-[#24152F] font-mono text-[10px]">
                      {activeGroup.sharedProducts.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDetailTab('activity')}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold border-2 transition-colors cursor-pointer ${
                      detailTab === 'activity'
                        ? 'bg-[#24152F] text-[#D9F36A] border-[#24152F]'
                        : 'bg-[#FFFFFF] text-[#24152F] border-[#E6D8CB] hover:border-[#24152F]'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Activities &amp; Members</span>
                  </button>
                </div>
              </div>

              {/* TAB 1: GROUP CHAT */}
              {detailTab === 'chat' && (
                <div className="flex flex-col">
                  <div className="p-5 sm:p-6 space-y-4 max-h-[430px] overflow-y-auto bg-[#FFFFFF]">
                    {activeGroup.messages.length === 0 ? (
                      <div className="py-10 text-center text-sm text-[#5E5468]">
                        No messages yet. Say hello or share a product to start planning!
                      </div>
                    ) : (
                      activeGroup.messages.map((msg) => {
                        const isMine = msg.senderId === currentUser.id;
                        return (
                          <div
                            key={msg.id}
                            className={`flex items-start gap-3 ${
                              isMine ? 'flex-row-reverse' : ''
                            }`}
                          >
                            <span
                              className={`w-8 h-8 rounded-xl text-xs font-extrabold flex items-center justify-center shrink-0 border ${
                                isMine
                                  ? 'bg-[#FF783D] text-[#24152F] border-[#24152F]'
                                  : 'bg-[#24152F] text-[#D9F36A] border-[#24152F]'
                              }`}
                            >
                              {msg.senderInitials}
                            </span>

                            <div
                              className={`max-w-[82%] sm:max-w-[72%] space-y-2 ${
                                isMine ? 'items-end text-right' : ''
                              }`}
                            >
                              <div
                                className={`flex items-center gap-2 text-[11px] font-bold text-[#5E5468] ${
                                  isMine ? 'justify-end' : ''
                                }`}
                              >
                                <span className="text-[#24152F]">{msg.senderName}</span>
                                <span>·</span>
                                <span>{formatRelativeTime(msg.createdAt)}</span>
                              </div>

                              <div
                                className={`px-4 py-2.5 rounded-2xl text-sm border text-left ${
                                  isMine
                                    ? 'bg-[#24152F] text-[#FFFFFF] border-[#24152F]'
                                    : 'bg-[#FFF8F0] text-[#29232F] border-[#E6D8CB]'
                                }`}
                              >
                                <p className="leading-relaxed">{msg.body}</p>

                                {msg.productId && msg.productName && (
                                  <button
                                    type="button"
                                    onClick={() => onSelectProduct(msg.productId!)}
                                    className="mt-2.5 w-full p-2.5 rounded-xl bg-[#FFFFFF] text-[#29232F] border-2 border-[#BBA5D5] hover:border-[#FF783D] flex items-center gap-3 text-left cursor-pointer transition-colors"
                                  >
                                    {msg.productImage && (
                                      <img
                                        src={msg.productImage}
                                        alt={msg.productName}
                                        className="w-11 h-11 rounded-lg object-cover border border-[#E6D8CB] shrink-0"
                                      />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <div className="text-xs font-extrabold text-[#24152F] truncate">
                                        {msg.productName}
                                      </div>
                                      {typeof msg.productPrice === 'number' && (
                                        <div className="text-xs font-mono font-bold text-[#FF783D]">
                                          {formatINR(msg.productPrice)}
                                        </div>
                                      )}
                                    </div>
                                    <span className="text-[11px] font-extrabold text-[#24152F] underline shrink-0">
                                      View
                                    </span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Chat Composer */}
                  <form
                    onSubmit={handleSendChat}
                    className="p-4 sm:p-5 bg-[#FFF8F0] border-t-2 border-[#E6D8CB] space-y-2.5"
                  >
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={chatText}
                        onChange={(e) => setChatText(e.target.value)}
                        placeholder={`Message ${activeGroup.name}...`}
                        className="flex-1 px-3.5 py-2.5 text-sm bg-[#FFFFFF] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#29232F] focus:outline-none"
                      />
                      <select
                        value={chatProductId}
                        onChange={(e) => setChatProductId(e.target.value)}
                        aria-label="Attach catalog product to chat"
                        className="sm:w-56 px-3 py-2.5 text-xs font-semibold bg-[#FFFFFF] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#29232F] focus:outline-none"
                      >
                        <option value="">Attach product (optional)</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({formatINR(p.price)})
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={sendingMsg || (!chatText.trim() && !chatProductId)}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#FF783D] hover:bg-[#F26324] text-[#24152F] text-xs font-extrabold border-2 border-[#24152F] cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        <Send className="w-3.5 h-3.5" strokeWidth={2.2} />
                        <span>{sendingMsg ? 'Sending...' : 'Send'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* TAB 2: SHARED PRODUCTS */}
              {detailTab === 'products' && (
                <div className="p-5 sm:p-6 space-y-6">
                  {/* Share a catalog item into the group */}
                  <form
                    onSubmit={handleShareSubmit}
                    className="p-4 rounded-2xl bg-[#FFF8F0] border-2 border-[#E6D8CB] space-y-3"
                  >
                    <div className="text-xs font-extrabold uppercase tracking-wider text-[#24152F]">
                      Share a Product with {activeGroup.name}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                      <select
                        value={shareProductId}
                        onChange={(e) => setShareProductId(e.target.value)}
                        className="md:col-span-5 px-3 py-2.5 text-xs font-semibold bg-[#FFFFFF] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#29232F] focus:outline-none"
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {formatINR(p.price)}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={shareNote}
                        onChange={(e) => setShareNote(e.target.value)}
                        placeholder="Add a note (e.g. Let us split 3 packs)"
                        className="md:col-span-5 px-3.5 py-2.5 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#29232F] focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={sharingProduct || !shareProductId}
                        className="md:col-span-2 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-[#D9F36A] hover:bg-[#C6E548] text-[#24152F] text-xs font-extrabold border-2 border-[#24152F] cursor-pointer disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" strokeWidth={2.2} />
                        <span>{sharingProduct ? 'Sharing...' : 'Share'}</span>
                      </button>
                    </div>
                  </form>

                  {/* Shared product list */}
                  {activeGroup.sharedProducts.length === 0 ? (
                    <div className="py-8 text-center text-sm text-[#5E5468]">
                      No products shared yet. Pick an item above to recommend it to your group.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {activeGroup.sharedProducts.map((sp) => {
                        const prod = sp.product;
                        const deal = prod.activeDeal;
                        const hasGroupDiscount = Boolean(deal);
                        const groupPrice = deal
                          ? Number((prod.price * (1 - deal.discountPercent / 100)).toFixed(2))
                          : prod.price;
                        const hasVoted = sp.upvotes.includes(currentUser.id);

                        return (
                          <div
                            key={sp.id}
                            className="p-4 rounded-2xl bg-[#FFFFFF] border-2 border-[#E6D8CB] hover:border-[#24152F] flex flex-col sm:flex-row gap-4 transition-colors"
                          >
                            <button
                              type="button"
                              onClick={() => onSelectProduct(prod.id)}
                              className="w-full sm:w-28 h-28 rounded-xl overflow-hidden border border-[#E6D8CB] shrink-0 cursor-pointer"
                            >
                              <img
                                src={prod.imageUrl}
                                alt={prod.name}
                                className="w-full h-full object-cover"
                              />
                            </button>

                            <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="text-[11px] font-bold text-[#5E5468] uppercase">
                                    {prod.category} · Shared by {sp.sharedByName}
                                  </span>
                                  <span className="text-[11px] font-semibold text-[#5E5468]">
                                    {formatRelativeTime(sp.createdAt)}
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => onSelectProduct(prod.id)}
                                  className="font-display text-base font-extrabold text-[#24152F] hover:text-[#FF783D] text-left cursor-pointer"
                                >
                                  {prod.name}
                                </button>

                                {sp.note && (
                                  <p className="text-xs text-[#29232F] bg-[#FFF8F0] px-3 py-1.5 rounded-lg border border-[#E6D8CB]">
                                    &ldquo;{sp.note}&rdquo;
                                  </p>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-baseline gap-2">
                                  <span className="font-mono text-base font-extrabold text-[#24152F]">
                                    {formatINR(hasGroupDiscount ? groupPrice : prod.price)}
                                  </span>
                                  {hasGroupDiscount && deal && (
                                    <>
                                      <span className="font-mono text-xs line-through text-[#5E5468]">
                                        {formatINR(prod.price)}
                                      </span>
                                      <span className="px-2 py-0.5 rounded-md bg-[#D9F36A] text-[#24152F] text-[10px] font-extrabold">
                                        {deal.discountPercent}% Group Savings
                                      </span>
                                    </>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void onToggleProductVote(activeGroup.id, prod.id)}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold border-2 cursor-pointer transition-colors ${
                                      hasVoted
                                        ? 'bg-[#BBA5D5] text-[#24152F] border-[#24152F]'
                                        : 'bg-[#FFF8F0] text-[#24152F] border-[#E6D8CB] hover:border-[#24152F]'
                                    }`}
                                  >
                                    <ThumbsUp className="w-3.5 h-3.5" />
                                    <span>Interested ({sp.upvotes.length})</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const added = await onAddToCart(prod, hasGroupDiscount, 1);
                                      if (added) {
                                        await onLogCartActivity(activeGroup.id, prod.name);
                                      }
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#FF783D] hover:bg-[#F26324] text-[#24152F] text-xs font-extrabold border-2 border-[#24152F] cursor-pointer"
                                  >
                                    <ShoppingCart className="w-3.5 h-3.5" />
                                    <span>Add to Cart</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: ACTIVITIES & MEMBERS */}
              {detailTab === 'activity' && (
                <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Shopping Activity Feed */}
                  <div className="space-y-3">
                    <h3 className="font-display text-base font-extrabold text-[#24152F]">
                      Group Shopping Activity
                    </h3>
                    <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                      {activeGroup.activities.length === 0 ? (
                        <p className="text-xs text-[#5E5468]">No activity recorded yet.</p>
                      ) : (
                        activeGroup.activities.map((act) => (
                          <div
                            key={act.id}
                            className="p-3 rounded-xl bg-[#FFF8F0] border border-[#E6D8CB] flex items-start justify-between gap-3"
                          >
                            <div className="text-xs text-[#29232F]">
                              <span className="font-extrabold text-[#24152F]">
                                {act.actorName}
                              </span>{' '}
                              <span className="text-[#5E5468]">· {act.summary}</span>
                            </div>
                            <span className="text-[11px] font-semibold text-[#5E5468] shrink-0">
                              {formatRelativeTime(act.createdAt)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Members & Invite Panel */}
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-display text-base font-extrabold text-[#24152F]">
                        Members ({activeGroup.members.length})
                      </h3>
                      <div className="mt-2.5 space-y-2">
                        {activeGroup.members.map((m) => (
                          <div
                            key={m.userId}
                            className="p-3 rounded-xl bg-[#FFF8F0] border border-[#E6D8CB] flex items-center justify-between gap-2"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="w-8 h-8 rounded-lg bg-[#24152F] text-[#D9F36A] text-xs font-extrabold flex items-center justify-center shrink-0">
                                {m.avatarInitials}
                              </span>
                              <div className="min-w-0">
                                <div className="text-xs font-extrabold text-[#24152F] truncate">
                                  {m.name}
                                  {m.userId === currentUser.id ? ' (You)' : ''}
                                </div>
                                <div className="text-[11px] text-[#5E5468] truncate">
                                  {m.email}
                                </div>
                              </div>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${
                                m.role === 'Owner'
                                  ? 'bg-[#FF783D] text-[#24152F]'
                                  : 'bg-[#BBA5D5] text-[#24152F]'
                              }`}
                            >
                              {m.role}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Invite Someone */}
                    <div className="p-4 rounded-2xl bg-[#FFF8F0] border-2 border-[#E6D8CB] space-y-3">
                      <div className="flex items-center gap-2 text-xs font-extrabold text-[#24152F]">
                        <UserPlus className="w-4 h-4 text-[#FF783D]" />
                        <span>Invite Friends or Family</span>
                      </div>

                      {invitableCustomers.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-semibold text-[#5E5468]">
                            Quick-invite CartSync customers:
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {invitableCustomers.map((u) => (
                              <button
                                key={u.id}
                                type="button"
                                onClick={async () => {
                                  setInviteError(null);
                                  try {
                                    await onInviteMember(activeGroup.id, { targetUserId: u.id });
                                  } catch (err) {
                                    setInviteError(
                                      err instanceof Error ? err.message : 'Unable to send invite.'
                                    );
                                  }
                                }}
                                className="px-2.5 py-1 rounded-lg bg-[#FFFFFF] hover:bg-[#ECFCCB] text-[#24152F] text-[11px] font-bold border border-[#24152F] cursor-pointer"
                              >
                                + Invite {u.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <form onSubmit={handleInviteSubmit} className="flex gap-2">
                        <div className="relative flex-1">
                          <Mail className="w-3.5 h-3.5 text-[#5E5468] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => {
                              setInviteEmail(e.target.value);
                              if (inviteError) setInviteError(null);
                            }}
                            placeholder="Invite by email address"
                            className="w-full pl-8 pr-3 py-2 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#29232F] focus:outline-none"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={inviting || !inviteEmail.trim()}
                          className="px-3.5 py-2 rounded-xl bg-[#24152F] text-[#D9F36A] text-xs font-extrabold cursor-pointer disabled:opacity-50"
                        >
                          {inviting ? 'Sending...' : 'Invite'}
                        </button>
                      </form>

                      {inviteError && (
                        <div className="text-[11px] font-bold text-[#C83E4D]">{inviteError}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
