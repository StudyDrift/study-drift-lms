"use client"
import Image from "next/image"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useInstallHook } from "@/hooks/use-install.hook"
import { useLoginMutation } from "@/redux/services/auth.api"
import { Spinner, Typography } from "@material-tailwind/react"
import React, { useState } from "react"

export default function Page() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [login, { isLoading }] = useLoginMutation()
  const [hasError, setHasError] = useState(false)

  useInstallHook()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      const results = await login({ email, password })

      if (results.error) {
        setHasError(true)
        console.log(results.error)
        return
      }
    } catch (error) {
      setHasError(true)
      return
    }

    setEmail("")
    setPassword("")

    window.location.href = "/"
  }

  return (
    <section className="w-screen h-screen flex items-center">
      <div className="w-full lg:grid lg:min-h-[600px] lg:grid-cols-2 xl:min-h-[800px]">
        <div className="flex items-center justify-center py-12">
          <div className="mx-auto grid w-[350px] gap-6">
            <div className="grid gap-2 text-center">
              <Image
                src="/logo-trimmed.svg"
                width={64}
                height={64}
                alt="Logo"
                className="mx-auto"
              />
              <h1 className="text-3xl font-bold">Login</h1>
              <p className="text-balance text-muted-foreground">
                Enter your email below to login to your account
              </p>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="m@example.com"
                    required
                    onChange={(e) => setEmail(e.target.value)}
                    value={email}
                    autoFocus
                  />
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center">
                    <Label htmlFor="password">Password</Label>
                    <Link
                      href="/forgot-password"
                      className="ml-auto inline-block text-sm underline"
                    >
                      Forgot your password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    required
                    onChange={(e) => setPassword(e.target.value)}
                    value={password}
                  />
                </div>
                {hasError && (
                  <Typography variant="small" className="text-red-500">
                    Invalid email or password
                  </Typography>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading && !hasError}
                >
                  {isLoading && <Spinner className="w-4 h-4 mr-2" />} Login
                </Button>
              </div>
            </form>
            <div className="mt-4 text-center text-sm">
              Don&apos;t have an account?{" "}
              <Link href="/auth/register" className="underline">
                Sign up
              </Link>
            </div>
          </div>
        </div>
        <div className="hidden bg-muted lg:block">
          <Image
            src="https://images.unsplash.com/photo-1497633762265-9d179a990aa6?q=80&w=2973&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
            alt="Image"
            width="1920"
            height="1080"
            className="h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
            priority
          />
        </div>
      </div>
    </section>
  )
}
