import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeExternalLinks from "rehype-external-links";
import rehypeHighlight from "rehype-highlight";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

/**
 * Renders AI-generated Markdown content safely.
 * - remarkGfm: tables, strikethrough, task lists, autolinks
 * - rehypeSanitize: strips any script/dangerous HTML from agent output
 * - rehypeHighlight: syntax-highlights fenced code blocks via highlight.js
 *
 * Uses Tailwind `prose` (via @tailwindcss/typography) for comfortable
 * typographic defaults. `max-w-none` prevents the prose width cap from
 * colliding with the surrounding layout.
 *
 * rehype plugin order matters:
 *   1. rehypeSanitize  — strip any dangerous HTML from agent output
 *   2. rehypeExternalLinks — annotate remaining safe anchors with target/rel
 *   3. rehypeHighlight — syntax-highlight fenced code blocks
 */
export const MarkdownContent = ({
  content,
  className = "",
}: MarkdownContentProps) => {
  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none min-w-0 prose-reset ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeSanitize,
          [
            rehypeExternalLinks,
            { target: "_blank", rel: ["noopener", "noreferrer"] },
          ],
          rehypeHighlight,
        ]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
