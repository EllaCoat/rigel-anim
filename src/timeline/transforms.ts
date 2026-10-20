interface Placed {
	position: THREE.Vector3
	quaternion: THREE.Quaternion
	scale: THREE.Vector3
}

export function keepTransforms(objects: Placed[]): () => void {
	const kept = objects.map((object) => ({ object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() }))
	return () => {
		for (const { object, position, quaternion, scale } of kept) {
			object.position.copy(position)
			object.quaternion.copy(quaternion)
			object.scale.copy(scale)
		}
	}
}
