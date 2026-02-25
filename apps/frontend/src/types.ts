export interface Agent {
    id: string;
    name: string;
    role: string;
    status: string;
    model: string;
    fallback: string;
}

export interface Task {
    id: string;
    title: string;
    status: string;
    priority: string;
    assignee: string | null;
    tags: string[];
    description: string;
}
