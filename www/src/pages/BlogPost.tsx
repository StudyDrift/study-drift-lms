import { ArrowLeft } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Header } from '../components/Header'
import { formatDate, getPost } from '../utils/blog'

export function BlogPost({ slug }: { slug: string }) {
  const post = getPost(slug)

  if (!post) {
    return (
      <div className="relative min-h-screen bg-stone-50 text-slate-700">
        <Header />
        <main className="mx-auto max-w-3xl px-4 py-24 sm:px-6 lg:px-8">
          <p className="text-stone-500">Post not found.</p>
          <a href="#/blog" className="btn-secondary mt-6 inline-flex gap-2">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to blog
          </a>
        </main>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-stone-50 text-slate-700">
      <Header />

      <main>
        {/* Post header */}
        <div className="border-b border-stone-200/90 bg-white py-12 sm:py-16">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <a
              href="#/blog"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 no-underline transition-colors hover:text-stone-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Blog
            </a>
            <time
              dateTime={post.date}
              className="mt-6 block text-xs font-medium uppercase tracking-widest text-stone-400"
            >
              {formatDate(post.date)}
            </time>
            <h1 className="font-display mt-3 text-3xl font-normal leading-tight tracking-tight text-stone-900 sm:text-4xl lg:text-[2.5rem]">
              {post.title}
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-stone-600">{post.description}</p>
            <p className="mt-4 text-sm text-stone-400">By {post.author}</p>
          </div>
        </div>

        {/* Post body */}
        <div className="py-12 sm:py-16">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <div className="prose-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {post.content}
              </ReactMarkdown>
            </div>

            <div className="mt-16 border-t border-stone-200/80 pt-10">
              <a href="#/blog" className="btn-secondary inline-flex gap-2">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back to all posts
              </a>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-stone-200/90 bg-white py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <p className="text-sm text-stone-400">© {new Date().getFullYear()} Lextures contributors</p>
        </div>
      </footer>
    </div>
  )
}
