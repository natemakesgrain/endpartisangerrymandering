import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

export default function Prose({
  children,
  wide = false,
}: {
  children: string;
  wide?: boolean;
}) {
  return (
    <article className={`prose ${wide ? 'prose-wide' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeSlug,
          [rehypeAutolinkHeadings, { behavior: 'wrap' }],
        ]}
      >
        {children}
      </ReactMarkdown>
    </article>
  );
}
