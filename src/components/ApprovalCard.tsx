import { useCurved } from '../store'

export function ApprovalCard() {
  const approvals = useCurved((s) => s.approvals)
  const bots = useCurved((s) => s.bots)
  const dismissApproval = useCurved((s) => s.dismissApproval)

  if (!approvals.length) return null

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 60, display: 'grid', gap: 10 }}>
      {approvals.map((approval) => {
        const bot = bots.find((b) => b.id === approval.botId)
        return (
          <div className="approval" key={approval.requestId} style={{ position: 'relative', right: 0, bottom: 0 }}>
            <h4>
              Allow {bot?.name ?? 'bot'}
              {bot ? <span style={{ color: bot.color }}> cursor</span> : ''} action?
            </h4>
            <pre>{JSON.stringify(approval.action, null, 2)}</pre>
            <div className="modal-actions">
              <button
                className="btn danger"
                type="button"
                onClick={async () => {
                  await window.curved?.approveAction(approval.requestId, false)
                  dismissApproval(approval.requestId)
                }}
              >
                Deny
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={async () => {
                  await window.curved?.approveAction(approval.requestId, true)
                  dismissApproval(approval.requestId)
                }}
              >
                Allow
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
