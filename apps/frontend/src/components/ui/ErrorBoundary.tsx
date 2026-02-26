import { Component, ReactNode, ErrorInfo } from 'react';
import { Terminal, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
    /** Optional custom fallback to render instead of the default full-screen panel. */
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * Top-level error boundary. Catches any rendering error in its sub-tree and
 * replaces the broken UI with a styled recovery screen instead of a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        // Surface to the console so devtools / Sentry can pick it up.
        console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
    }

    private handleReload = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;

            return (
                <div className="min-h-screen bg-[#08070b] text-slate-400 flex flex-col items-center justify-center p-8 font-sans">
                    <div className="max-w-lg w-full">
                        {/* Brand header */}
                        <div className="flex items-center gap-3 mb-10">
                            <div className="w-8 h-8 bg-violet-600 rounded flex items-center justify-center">
                                <Terminal size={18} className="text-white" />
                            </div>
                            <div>
                                <h1 className="text-sm font-bold tracking-widest text-white uppercase">ClawPilot</h1>
                                <div className="text-[9px] text-slate-500 font-mono tracking-tighter">MISSION_CONTROL // FAULT</div>
                            </div>
                        </div>

                        {/* Error panel */}
                        <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-6">
                            <p className="text-[10px] uppercase tracking-widest font-bold text-red-400 mb-2">
                                Unrecoverable render error
                            </p>
                            <p className="text-sm text-slate-300 mb-4">
                                A component crashed unexpectedly. Your session state is preserved — reloading the application should fix this.
                            </p>
                            {this.state.error && (
                                <pre className="text-[10px] font-mono text-red-400/80 bg-black/30 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all mb-5">
                                    {this.state.error.message}
                                </pre>
                            )}
                            <button
                                onClick={this.handleReload}
                                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-bold uppercase tracking-widest transition-all rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08070b]"
                            >
                                <RefreshCw size={12} />
                                Reload application
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
