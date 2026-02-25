import { useState, useRef, useEffect } from 'react';
import { Bot, X, ChevronRight, MessageSquare, Loader2 } from 'lucide-react';
import { useMissionStore } from '../../store/useMissionStore';
import { api } from '../../api/client';

export const ChatWidget = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [msg, setMsg] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const chatHistory = useMissionStore(state => state.chatHistory);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Provide initial history if empty
    const displayHistory = chatHistory.length > 0 ? chatHistory : [
        { sender: 'agent', message: 'System ready. How can I assist the squad today?' }
    ];

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [displayHistory, isTyping]);

    const handleSend = async () => {
        if (!msg.trim() || isTyping) return;

        const messageToSend = msg;
        setMsg("");
        setIsTyping(true);

        try {
            await api.sendChatMessageToAgent(messageToSend);
        } catch (error) {
            console.error("Failed to send message", error);
        } finally {
            setIsTyping(false);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-[60]">
            {isOpen ? (
                <div className="w-80 h-[450px] bg-white dark:bg-[#0c0a14] border border-black/10 dark:border-white/10 shadow-2xl flex flex-col animate-slideUp overflow-hidden">
                    <div className="p-3 border-b border-black/5 dark:border-white/5 flex items-center justify-between bg-violet-600/5">
                        <div className="flex items-center gap-2">
                            <Bot size={16} className="text-violet-600 dark:text-violet-400" />
                            <span className="text-[10px] uppercase tracking-widest font-bold text-slate-900 dark:text-white">Squad Terminal</span>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-slate-900 dark:hover:text-white">
                            <X size={14} />
                        </button>
                    </div>
                    <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto custom-scrollbar space-y-4">
                        {displayHistory.map((m: any, i) => (
                            <div key={i} className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}>
                                <span className="text-[8px] uppercase tracking-tighter text-slate-400 dark:text-slate-500 mb-1">
                                    {m.sender === 'user' ? 'Commander' : 'Main Frame'}
                                </span>
                                <div className={`text-[11px] p-2.5 rounded max-w-[85%] border ${m.sender === 'user'
                                    ? 'bg-violet-600/10 text-violet-900 dark:text-violet-100 border-violet-500/20'
                                    : 'bg-slate-50 dark:bg-white/5 text-slate-700 dark:text-slate-300 border-black/5 dark:border-white/5'
                                    }`}>
                                    {m.message}
                                </div>
                            </div>
                        ))}
                        {isTyping && (
                            <div className="flex flex-col items-start">
                                <span className="text-[8px] uppercase tracking-tighter text-slate-400 dark:text-slate-500 mb-1">Main Frame</span>
                                <div className="text-[11px] p-2.5 rounded max-w-[85%] border bg-slate-50 dark:bg-white/5 text-slate-700 dark:text-slate-300 border-black/5 dark:border-white/5 flex items-center gap-2">
                                    <Loader2 size={12} className="animate-spin" />
                                    <span>Typing...</span>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="p-3 border-t border-black/5 dark:border-white/5">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Message squad..."
                                value={msg}
                                onChange={(e) => setMsg(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                                className="w-full bg-slate-50 dark:bg-white/[0.03] border border-black/10 dark:border-white/10 rounded-sm py-2 pl-3 pr-10 text-[11px] text-slate-900 dark:text-slate-200 focus:border-violet-500/50 outline-none transition-all placeholder:text-slate-400"
                            />
                            <button onClick={handleSend} disabled={isTyping} className="absolute right-2 top-1.5 text-violet-600 dark:text-violet-500 disabled:opacity-50">
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <button
                    onClick={() => setIsOpen(true)}
                    className="w-12 h-12 bg-violet-600 hover:bg-violet-500 text-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110 active:scale-95"
                >
                    <MessageSquare size={22} />
                </button>
            )}
        </div>
    );
};
