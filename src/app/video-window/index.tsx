import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/video-window/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/video-window/"!</div>
}
