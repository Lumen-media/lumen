import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/home/")({
    component: RouteComponent,
});

function RouteComponent() {
    useEffect(() => {
        const ws = new WebSocket("ws://localhost:8080");

        ws.onopen = () => {
            console.log("connected");
            ws.send("Hello from client!");
        };

        ws.onmessage = (event) => {
            console.log(`received: ${event.data}`);
        };

        ws.onclose = () => {
            console.log("disconnected");
        };

        return () => {
            ws.close();
        };
    }, []);

    return (
        <div className="bg-lime-300">
            <h2 className="text-2xl bg-lime-400">Teste</h2>
        </div>
    );
}
