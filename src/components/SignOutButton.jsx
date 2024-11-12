"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export default function SignOutButton() {
  return (
    <Button
      onClick={() => signOut({ callbackUrl: "/" })}
      className="absolute top-4 right-4 bg-red-500 hover:bg-red-600 text-white"
    >
      Sign Out
    </Button>
  );
}
