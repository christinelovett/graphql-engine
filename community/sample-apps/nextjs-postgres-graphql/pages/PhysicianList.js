const PhysicianList = ({ physicians }) => (
  <div>
    {physicians && physicians.map((p, i) => (
      <div key={i}>
        <h2>{p.name}</h2>
      </div>
    ))}
  </div>
)

export default PhysicianList;
