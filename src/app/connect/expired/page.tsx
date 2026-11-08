export const metadata = { title: "Link expired", robots: { index: false } };

export default function Expired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-wash px-4">
      <div className="max-w-sm rounded-2xl border border-line bg-white p-8 text-center">
        <h1 className="text-lg font-semibold">This connect link has expired</h1>
        <p className="mt-2 text-sm text-muted">Connect links work once and expire after 30 minutes. Go back to the app and start the connection again.</p>
      </div>
    </div>
  );
}
