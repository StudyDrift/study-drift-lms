"use client"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  Typography,
} from "@material-tailwind/react"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

export default function Page() {
  const searchParams = useSearchParams()
  const isMock = searchParams.get("mock") === "1"
  const [first, setFirst] = useState("")
  const [last, setLast] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      const response = await fetch("/api/versions/install", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          first: first,
          last: last,
          email: email,
          password: password,
        }),
      })

      if (response.ok) {
        window.location.href = "/"
      }
    },
    [first, last, email, password]
  )

  useEffect(() => {
    if (isMock) {
      setFirst("Mock")
      setLast("User")
      setEmail("admin@example.com")
      setPassword("password")
      handleSubmit({ preventDefault: () => {} } as React.FormEvent)
    }
  }, [isMock, setFirst, setLast, setEmail, setPassword, handleSubmit])

  return (
    <section className="w-screen h-screen flex flex-col items-center mt-12">
      <Typography variant="h3">Welcome to StudyDrift!</Typography>
      <div className="w-96 mt-20">
        <form onSubmit={handleSubmit}>
          <Card>
            <CardBody>
              <Typography variant="h3" className="text-center">
                Install StudyDrift
              </Typography>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">First</Label>
                  <Input
                    id="first"
                    type="text"
                    placeholder="John"
                    required
                    onChange={(e) => setFirst(e.target.value)}
                    value={first}
                    autoFocus
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">Last</Label>
                  <Input
                    id="last"
                    type="text"
                    placeholder="Smith"
                    required
                    onChange={(e) => setLast(e.target.value)}
                    value={last}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="example@example.com"
                    required
                    onChange={(e) => setEmail(e.target.value)}
                    value={email}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    onChange={(e) => setPassword(e.target.value)}
                    value={password}
                  />
                </div>
              </div>
            </CardBody>
            <CardFooter>
              <Button
                fullWidth
                type="submit"
                disabled={!first || !last || !email || !password}
              >
                Install
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </section>
  )
}
