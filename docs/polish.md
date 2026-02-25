### Phase 1: Critical Security & Robustness 🔒
Currently, the backend has severe security vulnerabilities and stability risks that must be addressed before any production use.

*   [ ] **Fix Command Injection Vulnerabilities:** In `apps/backend/src/openclaw/cli.ts`, commands are executed using string interpolation (e.g., `execAsync(\`... --message "${prompt}"\` )`). If a user or AI inputs a quote (`"`), it breaks the script or allows arbitrary command execution. Refactor to use `child_process.spawn` or `execFile` with an array of arguments to avoid shell interpolation entirely.
*   [ ] **Enforce API Input Validation:** Fastify routes currently typecast incoming bodies (`const body = request.body as any`) without validation. Integrate the Zod schemas from `@claw-pilot/shared-types` using a Fastify validation compiler (e.g., `fastify-type-provider-zod`) to reject malformed requests.
*   [ ] **Address LowDB Concurrency:** `lowdb` is a simple JSON file database. If multiple concurrent requests trigger `await db.write()`, data corruption or loss can occur. Implement an in-memory write queue/mutex for database writes, or migrate to a more robust local database like SQLite (via `better-sqlite3`).
*   [ ] **Implement the "Review Gate" Logic:** As mandated in `AGENTS.md` and `api.md`, AIs must not be able to mark a task as `DONE`. Update `PATCH /api/tasks/:id` to check if the requester is an AI and return `403 Forbidden` if they attempt to transition a task to `DONE`.

### Phase 2: Backend Feature Completion ⚙️
Several endpoints defined in the documentation (`api.md`) are currently missing or incomplete.

*   [ ] **Complete Missing API Routes:**
    *   Implement `/api/models` to dynamically list available models instead of hardcoding them in the frontend.
    *   Implement `/api/agents/:id/files` (GET/PUT) to allow viewing/editing of agent configuration markdown files (`SOUL.md`, `TOOLS.md`).
    *   Implement Deliverables and Recurring task endpoints as outlined in `api.md`.
    *   Implement the `/api/chat` history GET endpoint (currently just returns `db.data.chat`).
*   [ ] **Expand Socket.io Emits:** The backend emits `task_updated` and `chat_message`, but needs to emit `task_created`, `task_deleted`, and `task_reviewed` to keep connected clients fully synced without refreshing.
*   [ ] **Refine Monitor Loops:** 
    *   In `stuckTaskMonitor.ts`, the database is modified and written directly. Ensure this plays nicely with the aforementioned db concurrency lock.
    *   Handle cases where the OpenClaw gateway is completely down (currently, `exec` commands will just throw unhandled exceptions that might crash the Fastify process if not carefully caught everywhere).

### Phase 3: Frontend Feature Completion & Integration 🖥️
The frontend looks good but heavily relies on mock data and incomplete integrations.

*   [ ] **Purge Mock Data:** Remove `INITIAL_TASKS`, `INITIAL_AGENTS`, and `MOCK_ACTIVITY` from `constants.ts`. Wire the `LiveFeed` component to a real activities fetcher in `useMissionStore`.
*   [ ] **Implement `addTask`:** The `addTask` function in `App.tsx` is stubbed (`// TODO: Update to use Backend API`). Connect the `NewTaskModal` form submission to the `POST /api/tasks` endpoint.
*   [ ] **Wire the Settings Modal to Real APIs:** The `SettingsModal.tsx` uses hardcoded `AVAILABLE_MODELS` and static gateway health text. Connect these to `/api/models` and `/api/monitoring/gateway/status`.
*   [ ] **Complete Socket Listeners:** In `useSocketListener.ts`, implement listeners for `agent_status_changed` and `activity_added` so the Live Feed and Agent Sidebar update in real-time.
*   [ ] **Fix Chat Widget Initialization:** The chat widget currently falls back to a hardcoded "System ready..." message if history is empty. It should actively fetch the history on mount and only display standard text if the database is truly empty.

### Phase 4: Type Safety & Code Quality 🧹
The TypeScript implementation currently has several loopholes that defeat the purpose of using TS.

*   [ ] **Remove `any` Castings in Frontend:**
    *   Fix the Kanban component props mapping (`tasks={filteredTasks... as any}`).
    *   Fix modal prop passing (`agents={agents as any}`).
    *   Fix `(task as any).tags` in `TaskCard.tsx` (Update the `Task` shared-type to explicitly include `tags: z.array(z.string())`).
*   [ ] **Fix Zustand Types:** In `useMissionStore.ts`, avoid using `(state as any).chatHistory`. Create a proper interface for Chat Messages in `@claw-pilot/shared-types` and type the store strictly.
*   [ ] **Environment Variables:** Remove hardcoded URLs (`http://localhost:54321`) in `client.ts` and `useSocketListener.ts`. Use Vite environment variables (e.g., `import.meta.env.VITE_API_URL`). Do the same for the backend port/host configurations.
*   [ ] **Add Testing:** Add unit tests for critical functions (e.g., the CLI string parsing logic, the Kanban state transitions). Set up a basic testing framework like Vitest.

### Phase 5: UI/UX Polish ✨
Make the application feel professional, responsive, and error-tolerant.

*   [ ] **Error Handling & Toasts:** If an API call fails (like an optimistic drag-and-drop Kanban update), the Zustand store reverts the state, but the user is never notified. Implement a toast notification system (e.g., `react-hot-toast` or `sonner`) to display errors, AI review rejections, and system alerts.
*   [ ] **Theme Persistence:** The Dark/Light mode toggle in `Header.tsx` defaults to `dark` on every reload. Save the user's preference to `localStorage` and initialize the state from there.
*   [ ] **Drag & Drop UX Enhancements:** 
    *   Currently, the `dnd-kit` implementation is basic. Add active drag overlays (so the card stays styled while dragging).
    *   Add logical constraints (e.g., UI should visually block dropping a task into `DONE` if the rules forbid it).
*   [ ] **Loading States & Skeletons:** Implement loading spinners or skeleton loaders when `isLoading` is true in `useMissionStore`, particularly for the Kanban columns and Agent sidebar on initial app load.
*   [ ] **Accessibility (a11y):** Add proper ARIA labels, focus-visible outlines for keyboard navigation, and ensure contrast ratios are sufficient in both Light and Dark modes.
*   [ ] **Responsive Design:** The layout (`Sidebar.tsx`, `LiveFeed.tsx`, `KanbanColumn.tsx`) assumes a wide desktop screen. Implement responsive break-points so the sidebar/feed can collapse into hamburger menus or bottom sheets on mobile/tablet resolutions.