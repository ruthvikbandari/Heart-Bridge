import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { CommentList, PostCard } from "../components/PostCard"
import { Button, Empty, Spinner } from "../components/ui"
import { api } from "../lib/api"
import type { Post } from "../lib/types"

export function PostPage() {
  const { id } = useParams()
  const post = useQuery({
    queryKey: ["post", id],
    queryFn: () => api<Post>(`/api/posts/${id}`),
  })
  if (post.isLoading) return <Spinner label="Loading post" />
  if (post.isError || !post.data) {
    return <Empty title="This post is unavailable" body="It may be private, removed, or from someone you blocked." action={<Link to="/home"><Button>Back home</Button></Link>} />
  }
  return (
    <div className="w-full space-y-6">
      <PostCard post={post.data} />
      <CommentList postId={post.data.id} />
    </div>
  )
}
