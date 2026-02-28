import { useMissionStore } from "../../store/useMissionStore";
import type { ActivityLog, Agent } from "@claw-pilot/shared-types";

function getAgentDisplayName(
  agentId: string | undefined,
  agents: Agent[],
): string {
  if (!agentId) return "Claw-Pilot";
  const agent = agents.find((a) => a.id === agentId);
  if (agent?.name) return agent.name;
  return agentId.charAt(0).toUpperCase() + agentId.slice(1);
}

function isReviewActivity(item: ActivityLog): boolean {
  return item.taskStatus === "REVIEW";
}

export const LiveFeed = () => {
  const activities = useMissionStore((state) => state.activities);
  const activitiesCursor = useMissionStore((state) => state.activitiesCursor);
  const loadMoreActivities = useMissionStore(
    (state) => state.loadMoreActivities,
  );
  const agents = useMissionStore((state) => state.agents);

  return (
    <div className="flex flex-col flex-1 min-h-0 border-t border-black/[0.04] dark:border-white/[0.04]">
      <div className="px-4 py-3 border-b border-black/[0.04] dark:border-white/[0.04]">
        <h2 className="text-[9px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500">
          Live Activity
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {activities.map((item) => {
          const isReview = isReviewActivity(item);
          return (
            <div
              key={item.id}
              className="relative pl-4 border-l border-black/5 dark:border-white/5 group"
            >
              <div
                className={`absolute top-1 -left-[3px] w-1.5 h-1.5 rounded-full transition-colors ${
                  isReview
                    ? "bg-[var(--accent-500)] dark:bg-[var(--accent-400)] shadow-[0_0_6px_var(--accent-500)] dark:shadow-[0_0_6px_var(--accent-400)]"
                    : "bg-slate-300 dark:bg-slate-700 group-hover:bg-[var(--accent-500)] dark:group-hover:bg-[var(--accent-400)]"
                }`}
              />
              <div
                className={`text-[10px] mb-0.5 leading-relaxed line-clamp-3 ${
                  isReview
                    ? "text-[var(--accent-600)] dark:text-[var(--accent-400)]"
                    : "text-slate-600 dark:text-slate-300"
                }`}
              >
                <span
                  className={`font-bold mr-1 ${
                    isReview
                      ? "text-[var(--accent-600)] dark:text-[var(--accent-400)]"
                      : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {getAgentDisplayName(item.agentId, agents)}
                </span>
                {item.message}
              </div>
              <div className="text-[8px] font-mono text-slate-400 dark:text-slate-600 uppercase">
                {new Date(item.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          );
        })}
        {activitiesCursor !== null && (
          <button
            onClick={loadMoreActivities}
            className="w-full text-[9px] uppercase tracking-[0.15em] font-bold text-slate-400 dark:text-slate-600 hover:text-[var(--accent-500)] dark:hover:text-[var(--accent-400)] py-2 transition-colors"
          >
            Load more
          </button>
        )}
      </div>
    </div>
  );
};
