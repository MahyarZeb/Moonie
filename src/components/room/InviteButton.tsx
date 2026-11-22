'use client';

import { useState } from 'react';
import { Check, Copy, Link2, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { copyText } from '@/lib/utils/clipboard';
import { inviteUrl } from '@/lib/utils/format';

/** The invite link and room code, each with a copy button. Shown inline in the lobby and in a dialog in the room. */
export function InvitePanel({ code }: { code: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const url = inviteUrl(code);

  async function copy(kind: 'link' | 'code') {
    const ok = await copyText(kind === 'link' ? url : code);
    if (!ok) return toast.show('Copy did not work. Select the text and copy it by hand.', 'error');
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="invite-link" className="mb-1 flex items-center gap-1.5 text-sm font-bold">
          <Link2 size={15} aria-hidden /> Invite link
        </label>
        <div className="flex gap-2">
          <input id="invite-link" readOnly className="input-soft min-w-0 flex-1 text-sm" value={url} onFocus={(e) => e.currentTarget.select()} />
          <Button size="sm" onClick={() => copy('link')} icon={copied === 'link' ? <Check size={16} /> : <Copy size={16} />}>
            {copied === 'link' ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      <div>
        <span className="mb-1 block text-sm font-bold">Room code</span>
        <div className="flex items-center gap-2">
          <span className="flex-1 rounded-2xl bg-surface-2 px-4 py-2 text-center font-display text-2xl font-bold tracking-[0.3em]">{code}</span>
          <Button size="sm" variant="secondary" onClick={() => copy('code')} icon={copied === 'code' ? <Check size={16} /> : <Copy size={16} />}>
            {copied === 'code' ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function InviteButton({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" icon={<Share2 size={16} />} onClick={() => setOpen(true)}>
        Invite
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Invite your friends 💌">
        <InvitePanel code={code} />
      </Modal>
    </>
  );
}
