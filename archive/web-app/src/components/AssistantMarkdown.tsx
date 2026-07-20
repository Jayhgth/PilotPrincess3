import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./GlobalAssistant.module.css";

export default function AssistantMarkdown({ text }: { text: string }) {
  return <div className={styles.messageBody}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a({ href, children, ...props }) {
          const external = Boolean(href && !href.startsWith("#"));
          return <a {...props} href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>{children}</a>;
        },
        input({ type, checked, ...props }) {
          return <input {...props} type={type} checked={checked} disabled readOnly />;
        }
      }}
    >
      {text}
    </ReactMarkdown>
  </div>;
}
