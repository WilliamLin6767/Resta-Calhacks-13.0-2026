import type { Metadata } from "next";
import { Suspense } from "react";
import Card from "@/components/Card";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Log in · Back of House" };

// The one page anyone can open: the owner's password, then back to where they were going.
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-gray-900">Back of House</h1>
        <p className="mt-1 text-sm text-gray-500">Enter the owner password to continue.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </Card>
    </main>
  );
}
