import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orbis — Happy Oyster World",
  description:
    "Minimal Reactor Happy Oyster prototype: one prompt-built first-person world with WASD movement and look controls.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
