import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/media/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/media/"!</div>
}
