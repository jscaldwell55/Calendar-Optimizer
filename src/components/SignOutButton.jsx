'use client'

import React from 'react'
import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"

const SignOutButton = () => {
  return (
    <Button
      onClick={() => signOut({ callbackUrl: "/" })}
      className="absolute top-4 right-4 bg-red-500 hover:bg-red-600 text-white"
    >
      Sign Out
    </Button>
  )
}

export default SignOutButton
