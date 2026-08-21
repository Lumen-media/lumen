import "./styles.css";

export const TypingLoader = ({ size = 6 }: { size?: number }) => {
    const px = `${size}px`;
    return (
        <div className="typing-loader" style={{ gap: `${size * 0.5}px` }}>
            <span style={{ width: px, height: px }} />
            <span style={{ width: px, height: px }} />
            <span style={{ width: px, height: px }} />
        </div>
    );
};